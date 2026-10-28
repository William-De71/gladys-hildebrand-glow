// -----------------------------------------------------------------------------
// Entry point of the Hildebrand Glow (DCC) external integration.
//
// British smart meters (SMETS2, and SMETS1 on the DCC) read through the
// Glowmarkt API of Hildebrand, the cloud of the free Bright app, with the
// e-mail and the password of the Bright account:
//   - devices: one per meter, electricity and gas (energy and cost of today
//     and yesterday, unit rate, standing charge, the power with a Glow
//     display; the electricity half-hours go to the Gladys energy screens),
//     offered on the Discovery screen (see src/device.js);
//   - scene triggers: yesterday summarized, tariff changed, data delayed /
//     resumed;
//   - scene actions: energy and cost of a period, read now;
//   - dashboard widgets: one meter (today, cost, chart), the connection.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the days; Europe/London when absent)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';
import { createGlowApi } from './src/glow-api.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys, { api: createGlowApi({ userAgent: `gladys-hildebrand-glow/${version}` }) });

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Hildebrand Glow integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
