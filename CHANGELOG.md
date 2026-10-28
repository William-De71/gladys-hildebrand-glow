# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-10-28

### Added

- British smart meters (SMETS2, and SMETS1 on the DCC) through the Glowmarkt API of Hildebrand, the cloud of the free Bright app, with the e-mail and the password of the Bright account; a "Test the connection" button.
- One device per meter, electricity and gas: energy and cost of today and of yesterday, unit rate and standing charge (pounds), and the power when the account has a Glow display (IHD or CAD).
- The electricity half-hours go to the Gladys energy screens at their real time, however late the DCC delivers them (dated consumption, never an index), with up to 90 days of history when the meter is added; corrected half-hours are published again.
- A light pace: one catchup per meter just after each half-hour (as the Glowmarkt documentation asks, can be turned off), the readings 10 minutes after it (every 30 or 60 minutes), the meters and tariffs every 6 hours; 429 and outages slow down instead of insisting.
- Scene triggers: the figures of yesterday are ready, the tariff changes, a meter stops sending data and sends them again; each one filtered by meter and energy.
- Scene actions: the energy and the cost of a period (today, yesterday, this week, the last 7 days, this month, last month, the last 30 days), read the meters now.
- Dashboard widgets: one meter (today, its cost, yesterday or the last 7 / 30 days, the power, a chart by half-hour or by day) and the connection (how recent the data of each meter are, tariffs).
- English, French, German and Spanish everywhere: settings, devices, widgets, scenes and documentation.

[0.1.0]: https://github.com/William-De71/gladys-hildebrand-glow/releases/tag/v0.1.0
