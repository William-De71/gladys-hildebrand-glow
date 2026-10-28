# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for British smart meters (SMETS2,
and SMETS1 on the DCC) read through the **Glowmarkt API of Hildebrand**, the
cloud behind the free Bright app: a Node.js service (Node 22+, ESM, no build
step) that runs in its own sandboxed Docker container and talks to Gladys
through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. Sign-in with the e-mail and the password of the
Bright account. Documentation of the API (Swagger):
https://api.glowmarkt.com/api-docs/v0-1/resourcesys/ and
https://api.glowmarkt.com/api-docs/v0-1/vesys/. Transport: cloud.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
DEBUG=gladys-integration-sdk npm test     # with the SDK debug logs
npm run coverage                          # tests with the coverage of node --test
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only (new GladysIntegration + createApp)
src/app.js              every handler, registered before connect(); the clock
                        (catchup, readings, tariffs, power, history), the
                        dated half-hours given to Gladys, the errors (refused
                        sign-in, 429, outages), the status
src/glow-api.js         the HTTP client: sign-in (token ~7 days, renewed 1 h
                        before `exp` and once on 401 / 403 / 404), one request
                        at a time 1 s apart, 429 / 5xx reported, error
                        classes; never logs a secret
src/glow.js             the data model: meters from the virtual entities and
                        their classifiers, local days and clock changes,
                        half-hours, tariff (two shapes), current power
src/device.js           one Gladys device per meter, its features and states
src/events.js           scene trigger detection (transitions), periods of the
                        scene action
src/widgets.js          meter and status dashboard widgets
src/state.js            /data/state.json: half-hours (3 days), days (70),
                        latest half-hour, what Gladys got, tariff, power
                        probe, trigger snapshots
src/config.js           configuration (e-mail, password, paces, history,
                        catchup, language), timezone (London by default)
src/i18n.js             runtime texts, en / fr / de / es
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by the store
docs/illustrations/     generated widget images (render.sh, gen.mjs, render.js)
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: the device
  external id `ext:<selector>:meter:<Glowmarkt consumption resource id>`
  (URI-encoded, never a name), the feature keys (`consumption`,
  `energy_today`, `energy_yesterday`, `cost_today`, `cost_yesterday`,
  `unit_rate`, `standing_charge`, `power`), feature `category` / `type` /
  `unit` / `min` / `max` / `step`, the keys of `config_schema`, `actions`, the
  select values (`30`, `60`, `1`, `2`, `5`, `10`, `0`, `7`, `31`, `90`,
  `auto`…), the widgets and their settings (`device`, `range`: `day`, `week`,
  `month`), the widget button (`refresh`), the scene triggers (fields,
  variables) and scene actions (fields, periods, outputs).
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update the baseline to make a
  test pass without a documented migration.
- **One device per meter**: one consumption resource (`electricity.consumption`
  or `gas.consumption`) of a virtual entity, with the cost resource of the
  same commodity when there is one.
- **Energy in Gladys (core 5.3.0)**: the DCC data are late (30 minutes to
  hours), so NEVER publish an index (`energy-sensor` / `index` or `energy`):
  Gladys would put a whole late batch in one half-hour. The electricity
  half-hours go to the `thirty-minutes-consumption` feature with
  `publishEnergyConsumption`, dated at their real time (Gladys derives the
  cost feature itself), only the new or corrected ones (`sent` in /data). Gas
  never: Gladys attaches every consumption to the main ELECTRIC meter.
  Today / yesterday are `index-today` / `index-yesterday` (outside the energy
  pipeline); costs and tariff are `currency` / `decimal` in `pound-sterling`
  (the API gives pence).
- **The pace** (fair use of a free cloud): `should_poll` stays false;
  one `catchup` per meter 1 to 3 minutes after each half-hour (the Glowmarkt
  documentation: once per half-hour, random delay up to 2 minutes), the
  readings 10 minutes after it (every 30 or 60 min), meters and tariffs every
  6 hours, the power every 1 to 10 min only when `current` answers (a Glow
  display), the history once per added meter (10 days per PT30M request, the
  limit of the API). Never add a request per feature.
- **Errors**: refused sign-in (`401 {"valid": false}`) is retried every
  30 minutes or as soon as the credentials change; 429 pauses (Retry-After,
  doubled, up to 2 h); other errors 5, 10, 20, 30 min. An unknown token gets
  `404 {"error":"Not found"}` (checked live): renew once, then trust the 404.
- **Days** are those of the Gladys timezone, Europe/London when Gladys gives
  none (or UTC); 46 / 50 half-hours on clock-change days.
- **The password** is a `secret`: never logged, never in /data, never in a
  scene variable nor an error message; neither is the token.
- **Scene events**: one per transition between two readings of a meter the
  user added (baseline at the first reading, kept in /data across restarts).
- **Gladys does not pass DEBUG / LOG_LEVEL to the container**: never tell a
  store user to set them; "Test the connection" is the diagnostic button.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, runtime messages in
  `src/i18n.js`, `docs/*.md`, README) exists in English, French, German and
  Spanish. `test/i18n.test.js` checks it. A widget caption stays under 80
  characters (Gladys truncates it).
- **Widget images.** After any change to the content of a widget, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **No copied code.** The protocol facts come from the official Swagger
  documents, pyglowmarkt (Apache-2.0), the Home Assistant custom integration
  ha-hildebrandglow-dcc (MIT) and glowmarkt-rs (MIT), credited in NOTICE.
- **Never tested on a real account**: the fixtures follow the documentation;
  say so in any change that relies on an answer shape.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  The version stays below 1.0.0 until the maintainer runs the Release workflow
  with `release-as: 1.0.0`.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing.
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language; the file stays under
  100 KB. `>=5.3.0` (keywords, countries, dated consumption);
  `countries: ["GB"]` (the DCC is British); no permission. Transport:
  `["cloud"]`.
- **CI smoke test.** `ci.yml` counts the features of an electricity meter (8)
  and of a gas meter (6) in the Docker image: update it with the features.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
