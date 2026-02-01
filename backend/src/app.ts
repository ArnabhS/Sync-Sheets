import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { ConfigStore } from './store/ConfigStore';
import { ConfigRepository } from './store/ConfigRepository';
import { GoogleSheetsService } from './services/GoogleSheetsService';
import { MysqlService } from './services/MysqlService';
import { SyncEngine, SyncEvent } from './services/SyncEngine';
import { SyncScheduler } from './services/SyncScheduler';
import { createSyncRoutes } from './routes/syncRoutes';
import { createDbRoutes } from './routes/dbRoutes';

export async function createApp(wsBroadcast: (payload: object) => void) {
  const configRepository = new ConfigRepository(env.mysql);
  await configRepository.ensureTable();
  const configStore = new ConfigStore(configRepository);
  const sheetsService = new GoogleSheetsService(env.google.credentialsPath);
  const mysqlService = new MysqlService(env.mysql);

  const syncEngine = new SyncEngine({
    sheets: sheetsService,
    mysql: mysqlService,
    getState: (id) => configStore.getState(id),
    setState: (id, state) => configStore.setState(id, state),
    onEvent: (event: SyncEvent) => {
      wsBroadcast({ type: 'sync', payload: event });
    },
  });

  const syncScheduler = new SyncScheduler(
    {
      getConfigs: () => configStore.listConfigs(),
      runSync: (config) => syncEngine.runSync(config),
      onEvent: (event) => wsBroadcast({ type: 'sync', payload: event }),
    },
    env.sync.sheetPollIntervalSec
  );

  syncScheduler.start();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/sync', createSyncRoutes(configStore, syncScheduler, sheetsService));
  app.use('/api', createDbRoutes(configStore, mysqlService));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return { app, syncScheduler, mysqlService };
}
