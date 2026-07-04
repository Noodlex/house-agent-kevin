"""Constants for the House Agent Kevin integration."""

from __future__ import annotations

DOMAIN = "kevin"
PLATFORMS = ["switch", "sensor"]

# Persistence
STORAGE_VERSION = 1
STORAGE_KEY = "kevin.plan"

# Dispatcher signal (per config entry)
SIGNAL_UPDATE = "kevin_update_{}"

# Config keys
CONF_MIXES = "mixes"
CONF_SEJOUR = "sejour"
CONF_RULE = "rule"
CONF_OVERRIDES = "overrides"
CONF_SAFETY_OFF = "safety_off"
CONF_START_DATE = "start_date"
CONF_END_DATE = "end_date"

# Planning modes (rule.mode)
MODE_GLOBAL = "global"          # one mix, replayed every evening
MODE_POOL = "pool"              # random pick from a pool of mixes
MODE_WEEKDAY = "weekday"        # weekday -> mix mapping
MODE_ROTATION = "rotation"      # A -> B -> C (-> D), then loops

# Anchor types
ANCHOR_FIXED = "fixed"
ANCHOR_SUN = "sun"
SUN_SUNRISE = "sunrise"
SUN_SUNSET = "sunset"

# Event actions
ACTION_ON = "on"
ACTION_OFF = "off"
ACTION_ONESHOT = "oneshot"
ACTION_SAFETY_OFF = "safety_off"
ENTITY_ALL = "__all__"

# Defaults
DEFAULT_JITTER_MINUTES = 20
DEFAULT_SAFETY_OFF = "01:00"

# Services
SERVICE_START = "start"
SERVICE_STOP = "stop"
SERVICE_REGENERATE = "regenerate_schedule"
