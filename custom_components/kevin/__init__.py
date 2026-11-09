"""House Agent Kevin — presence simulation for Home Assistant.

Simulates presence while you're away (Home Alone style): a master switch arms a
pre-generated, persisted plan that turns lights on/off in a plausible,
never-repeating order, anchored to the real sunset.

See VISION.md and docs/MVP-PLAN.md in the repo.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall

from . import api
from .const import (
    DOMAIN,
    PLATFORMS,
    SERVICE_REGENERATE,
    SERVICE_START,
    SERVICE_STOP,
)
from .coordinator import KevinCoordinator
from .models import KevinConfig
from .preset import load_preset

_LOGGER = logging.getLogger(__name__)

_CARD_FILE = "house-agent-kevin-card.js"
_CARD_PATH = os.path.join(os.path.dirname(__file__), "frontend", _CARD_FILE)
_CARD_URL = f"/{DOMAIN}_static/{_CARD_FILE}"
_FRONTEND_REGISTERED = f"{DOMAIN}_frontend_registered"
_MODULE_URL = f"{DOMAIN}_module_url"

# Le panneau latéral. Une URL de tableau de bord Lovelace contient forcément un
# tiret : « kevin » ne peut donc jamais entrer en collision avec un tableau de
# bord créé par l'utilisateur (même s'il l'a appelé « house-agent-kevin »).
PANEL_URL = "kevin"
PANEL_ELEMENT = "house-agent-kevin-panel"
CONF_SHOW_PANEL = "show_panel"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up House Agent Kevin from a config entry."""
    raw = (
        entry.options.get("config")
        or entry.data.get("config")
        or await hass.async_add_executor_job(load_preset)
    )
    config = KevinConfig.from_dict(raw)

    # Fingerprint of the entry-provided config. The coordinator keeps card edits
    # across restarts, but a change here (i.e. the user went through the options
    # form) is an explicit reset and wins.
    source_rev = hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()[:16]

    coordinator = KevinCoordinator(hass, entry, config, source_rev)
    await coordinator.async_load()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _register_services(hass)
    api.async_register(hass)
    await _register_frontend(hass)
    if entry.options.get(CONF_SHOW_PANEL, True):
        await _register_panel(hass)
    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    return True


async def _register_panel(hass: HomeAssistant) -> None:
    """Give Kevin a home in the sidebar.

    Sans lui, Kevin n'apparaît nulle part après l'installation : il faut savoir
    créer un tableau de bord et y déposer une carte personnalisée, et un
    tableau de bord laissé vide n'affiche qu'une page blanche, sur laquelle on
    ne peut même pas mettre d'aide. Le panneau réutilise la carte telle quelle.
    """
    try:
        from homeassistant.components import panel_custom

        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL,
            webcomponent_name=PANEL_ELEMENT,
            sidebar_title="House Agent Kevin",
            sidebar_icon="mdi:home-account",
            # Même URL que la carte, version comprise : le navigateur ne charge
            # le module qu'une fois, qu'on arrive par le panneau ou un tableau.
            module_url=hass.data[_MODULE_URL],
            embed_iframe=False,
            require_admin=False,  # les écritures sont déjà réservées aux admins
        )
    except Exception as err:  # noqa: BLE001 — la carte reste utilisable sans
        _LOGGER.warning("Could not register the Kevin sidebar panel: %s", err)


def _remove_panel(hass: HomeAssistant) -> None:
    try:
        from homeassistant.components.frontend import async_remove_panel

        async_remove_panel(hass, PANEL_URL)
    except Exception:  # noqa: BLE001 — absent si l'option était décochée
        pass


async def _register_frontend(hass: HomeAssistant) -> None:
    """Serve the Lovelace card and load it, once, tolerant to HA API changes."""
    if hass.data.get(_FRONTEND_REGISTERED):
        return
    hass.data[_FRONTEND_REGISTERED] = True
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(_CARD_URL, _CARD_PATH, cache_headers=False)]
        )
    except ImportError:  # older HA
        hass.http.register_static_path(_CARD_URL, _CARD_PATH, cache_headers=False)

    # Cache-bust the auto-loaded module by version, so browsers (and the HA
    # service worker) fetch the new card after an update instead of a stale copy.
    version = "0"
    try:
        from homeassistant.loader import async_get_integration

        integration = await async_get_integration(hass, DOMAIN)
        version = str(integration.version)
    except Exception:  # noqa: BLE001
        pass

    hass.data[_MODULE_URL] = f"{_CARD_URL}?v={version}"
    try:
        from homeassistant.components.frontend import add_extra_js_url

        add_extra_js_url(hass, hass.data[_MODULE_URL])
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Could not auto-load the Kevin card (%s); add it as a resource manually", err)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    coordinator: KevinCoordinator | None = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator is not None:
        await coordinator.async_disarm()
    _remove_panel(hass)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            _unregister_services(hass)
    return unload_ok


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


def _coordinators(hass: HomeAssistant) -> list[KevinCoordinator]:
    return list(hass.data.get(DOMAIN, {}).values())


def _register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_START):
        return

    async def _start(call: ServiceCall) -> None:
        for coordinator in _coordinators(hass):
            await coordinator.async_arm(regenerate=True)

    async def _stop(call: ServiceCall) -> None:
        for coordinator in _coordinators(hass):
            await coordinator.async_disarm()

    async def _regenerate(call: ServiceCall) -> None:
        for coordinator in _coordinators(hass):
            await coordinator.async_regenerate()

    hass.services.async_register(DOMAIN, SERVICE_START, _start)
    hass.services.async_register(DOMAIN, SERVICE_STOP, _stop)
    hass.services.async_register(DOMAIN, SERVICE_REGENERATE, _regenerate)


def _unregister_services(hass: HomeAssistant) -> None:
    for service in (SERVICE_START, SERVICE_STOP, SERVICE_REGENERATE):
        hass.services.async_remove(DOMAIN, service)
