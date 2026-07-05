# Lovelace card (frontend)

The card now lives inside the integration at
[`custom_components/kevin/frontend/house-agent-kevin-card.js`](../custom_components/kevin/frontend/house-agent-kevin-card.js)
and is **auto-served + auto-loaded** by the integration (no manual Lovelace
resource needed). Add it to a dashboard with:

```yaml
type: custom:house-agent-kevin-card
```

It fetches the generated plan over the WebSocket API (`kevin/get_plan`) and
renders the two-timeline previewer: the **séjour** plan (macro, colored by mix)
above, the **evening** mix (micro) below, on the **sun transition layer** (day /
transition / night), with day-by-day navigation, an arm toggle and a regenerate
button.

🚧 v1 is a **read-only previewer**. Drag-to-edit clips comes in a later phase.
