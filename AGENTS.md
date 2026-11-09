# Musonoi WMS

- For user-facing changes, apply the [UI design rules](docs/uiux/DESIGN.md) and the [review checklist](docs/uiux/QUALITY.md).
- Reuse the existing page shell, buttons, form controls, table containers and workflow components. Use the shared UI tokens for new visual values.
- Add new page and state examples to `tests/release/uiux-routes.cjs`. Run the static UI gate, affected browser checks and business regression before handoff. Record uncovered roles or states explicitly.
- Keep permission checks, approval actions, calculation units, statutory warnings and historical data intact when making UI changes. Review dependency and permission behavior before removing a business control.
