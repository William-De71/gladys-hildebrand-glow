<!--
The TITLE of this pull request becomes the squash commit, then the line users
read in CHANGELOG.md and in the GitHub Release. Write it in English, as a
Conventional Commit describing the change for the user:

  feat(widgets): show the floor temperature in the rooms widget
  fix(device): keep the setpoint of the holiday mode after a reading
  perf: read only the devices that changed after a command
  docs: explain the external temperature of a covered radiator

feat -> minor version, fix / perf -> patch, `!` or a "BREAKING CHANGE:" footer
-> breaking (a minor while the version is below 1.0.0). docs, chore, ci, test,
style, refactor and build alone publish no release. Never edit CHANGELOG.md.
-->

## What changes for the user

## How it was tested

- [ ] `npm run format:check`, `npm run lint` and `npm test` pass
- [ ] Tried in Gladys (Gladys version: …, meters: electricity / gas, Glow display: yes / no)
- [ ] The four docs (`docs/en.md`, `fr`, `de`, `es`) and READMEs are up to date
