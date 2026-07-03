"""Constants for the House Agent Kevin integration."""

DOMAIN = "kevin"

# Config / options keys
CONF_ENTITIES = "entities"
CONF_HOLIDAY_START = "holiday_start"
CONF_HOLIDAY_END = "holiday_end"
CONF_JITTER_MINUTES = "jitter_minutes"
CONF_MODE = "mode"
CONF_SCHEMAS = "schemas"

# Planning modes
MODE_GLOBAL = "global"          # one daily schema, re-rolled each day
MODE_POOL = "pool"              # random pick from a pool of schemas
MODE_PER_WEEKDAY = "weekday"    # weekday -> schema mapping
MODE_ROTATION = "rotation"      # A -> B -> C (-> D) over N days

# Defaults
DEFAULT_JITTER_MINUTES = 20

# Services
SERVICE_START = "start"
SERVICE_STOP = "stop"
SERVICE_REGENERATE = "regenerate_schedule"
