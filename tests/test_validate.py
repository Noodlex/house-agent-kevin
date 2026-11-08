"""Garde-fou des références de scénarios.

Supprimer un scénario sans nettoyer ce qui le vise ne casse rien de visible :
`generate_plan` fait `mixes.get(id)` -> None et saute la journée. Le séjour
rétrécit en silence. Ces tests vérifient que `KevinConfig.validate()` refuse
chacune des quatre formes de référence pendante — et, en miroir, que le
générateur perd bien des jours quand on ne valide pas (c'est ce qui justifie
le garde-fou).
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from conftest import preset_dict
from kevin_pure import models
from kevin_pure.generator import generate_plan
from kevin_pure.sun import Location

PARIS = Location(latitude=48.8566, longitude=2.3522, time_zone="Europe/Paris", elevation=35.0)
NOW = datetime(2026, 7, 19, 23, 0, tzinfo=ZoneInfo("Europe/Paris"))


def _config():
    return models.KevinConfig.from_dict(preset_dict())


def test_le_preset_est_coherent():
    _config().validate()  # ne lève pas


def test_suppression_sans_nettoyage_perd_des_jours_en_silence():
    """La raison d'être de validate() : sans lui, personne n'est prévenu."""
    config = _config()
    full = len(generate_plan(config, PARIS, 7, NOW).days)

    del config.mixes["week_end_c"]  # toujours visé par overrides["2026-07-25"]
    shrunk = generate_plan(config, PARIS, 7, NOW).days

    assert len(shrunk) < full          # des soirées ont disparu
    assert "2026-07-25" not in shrunk  # celle-là précisément
    with pytest.raises(ValueError):    # et validate() l'aurait arrêté
        config.validate()


def test_reference_pendante_depuis_les_jours_peints():
    config = _config()
    config.sejour.overrides["2026-07-22"] = "inexistant"
    with pytest.raises(ValueError, match="inexistant"):
        config.validate()


def test_reference_pendante_depuis_la_liste_de_la_regle():
    config = _config()
    config.sejour.rule.mixes.append("fantome")
    with pytest.raises(ValueError, match="fantome"):
        config.validate()


def test_reference_pendante_depuis_la_carte_hebdomadaire():
    config = _config()
    config.sejour.rule = models.Rule.from_dict({"mode": "weekday", "map": {"sat": "disparu"}})
    with pytest.raises(ValueError, match="disparu"):
        config.validate()


def test_reference_pendante_depuis_le_mix_unique():
    config = _config()
    config.sejour.rule = models.Rule.from_dict({"mode": "global", "mix": "evapore"})
    with pytest.raises(ValueError, match="evapore"):
        config.validate()


def test_aucun_scenario_du_tout():
    config = _config()
    config.mixes = {}
    with pytest.raises(ValueError):
        config.validate()


def test_cle_et_id_desaccordes():
    """Renommer la clé du dict sans renommer l'id (ou l'inverse) se voit."""
    config = _config()
    config.mixes["autre_cle"] = config.mixes.pop("soiree_a")
    config.sejour.rule.mixes = ["autre_cle", "soiree_b"]
    with pytest.raises(ValueError, match="autre_cle"):
        config.validate()


@pytest.mark.parametrize(
    "rule",
    [
        {"mode": "global"},                      # aucun mix désigné
        {"mode": "rotation", "mixes": []},       # liste vide
        {"mode": "pool", "mixes": []},
        {"mode": "weekday", "map": {}},          # ni carte ni repli
    ],
)
def test_mode_incapable_de_designer_un_scenario(rule):
    config = _config()
    config.sejour.rule = models.Rule.from_dict(rule)
    config.sejour.overrides = {}
    with pytest.raises(ValueError):
        config.validate()


def test_fin_avant_debut():
    """Saisie inversée dans le panneau absence : `dates()` rendrait [] et le
    plan serait vide, sans que rien ne le signale."""
    config = _config()
    config.sejour.end_date = config.sejour.start_date - timedelta(days=1)
    with pytest.raises(ValueError, match="précède"):
        config.validate()
    assert config.sejour.dates() == []  # ce que le garde-fou évite


def test_sejour_d_un_seul_jour_reste_valide():
    config = _config()
    config.sejour.end_date = config.sejour.start_date
    config.sejour.overrides = {}
    config.validate()
    assert len(generate_plan(config, PARIS, 7, NOW).days) == 1


def test_sejour_delirant_refuse():
    """Faute de frappe sur l'année : le plan entier est persisté jour par jour."""
    config = _config()
    config.sejour.end_date = config.sejour.start_date + timedelta(days=400)
    with pytest.raises(ValueError, match="faute de frappe"):
        config.validate()


def test_une_annee_pile_passe():
    config = _config()
    config.sejour.end_date = config.sejour.start_date + timedelta(days=366)
    config.validate()  # la borne est inclusive, on ne refuse pas pile un an


def test_suppression_proprement_nettoyee_passe():
    """Le résultat attendu du CRUD de la carte : toutes les visées recalées."""
    config = _config()
    del config.mixes["week_end_c"]
    config.sejour.overrides = {
        k: v for k, v in config.sejour.overrides.items() if v != "week_end_c"
    }
    config.sejour.rule.mixes = [m for m in config.sejour.rule.mixes if m != "week_end_c"]
    config.validate()  # ne lève pas

    # et le séjour garde toutes ses soirées
    assert len(generate_plan(config, PARIS, 7, NOW).days) == len(config.sejour.dates())
