# Completion gate
Run from project root, in order:
1. `npm run lint`
2. `npm run test`
3. `npm run build`
For Apps Script/report changes also run the schema/report assertions in the full test suite and inspect generated headers/field mappings in `apps-script/Reports.gs`; Apps Script has no separate local compiler in this repo.