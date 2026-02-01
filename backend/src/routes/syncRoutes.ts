import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { SyncConfig } from '../types/sync';
import { ConfigStore } from '../store/ConfigStore';
import { SyncScheduler } from '../services/SyncScheduler';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

export function createSyncRoutes(
  configStore: ConfigStore,
  syncScheduler: SyncScheduler,
  sheetsService: GoogleSheetsService
): Router {
  const router = Router();

  router.get('/configs', async (_req: Request, res: Response) => {
    try {
      const configs = await configStore.listConfigs();
      const withState = configs.map((c) => ({
        ...c,
        state: configStore.getState(c.id),
      }));
      res.json({ configs: withState });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/configs/:id', async (req: Request, res: Response) => {
    const config = await configStore.getConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Config not found' });
    res.json({ config: { ...config, state: configStore.getState(config.id) } });
  });

  interface CreateBody {
    name: string;
    spreadsheetId: string;
    sheetName?: string;
    range: string;
    tableName: string;
    idColumn?: string;
    columnMapping?: Record<string, string>;
    mysql?: SyncConfig['mysql'];
  }

  router.post('/configs', async (req: Request, res: Response) => {
    const body = req.body as CreateBody;
    if (!body.name || !body.spreadsheetId || !body.range || !body.tableName) {
      return res.status(400).json({
        error: 'Missing required fields: name, spreadsheetId, range, tableName',
      });
    }
    const id = uuidv4();
    const config: SyncConfig = {
      id,
      name: body.name,
      spreadsheetId: body.spreadsheetId,
      sheetName: body.sheetName ?? 'Sheet1',
      range: body.range,
      mysql: body.mysql,
      tableName: body.tableName,
      columnMapping: body.columnMapping ?? {},
      idColumn: body.idColumn ?? 'id',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await configStore.setConfig(config);
    res.status(201).json({ config });
  });

  router.patch('/configs/:id', async (req: Request, res: Response) => {
    const config = await configStore.getConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Config not found' });
    const allowed: (keyof SyncConfig)[] = ['name', 'active', 'range', 'sheetName', 'columnMapping', 'idColumn'];
    const updates = req.body as Partial<SyncConfig>;
    for (const key of allowed) {
      if (updates[key] !== undefined) (config[key] as unknown) = updates[key];
    }
    config.updatedAt = new Date().toISOString();
    await configStore.setConfig(config);
    res.json({ config });
  });

  router.delete('/configs/:id', async (req: Request, res: Response) => {
    const ok = await configStore.deleteConfig(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Config not found' });
    res.status(204).send();
  });

  router.post('/configs/:id/sync', async (req: Request, res: Response) => {
    const config = await configStore.getConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Config not found' });
    try {
      const event = await syncScheduler.triggerNow(config.id);
      res.json({ success: true, event });
    } catch (e) {
      res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get('/configs/:id/sheet-preview', async (req: Request, res: Response) => {
    const config = await configStore.getConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Config not found' });
    try {
      const result = await sheetsService.readRange(config);
      res.json({ headers: result.headers, rows: result.rows, rawValues: result.rawValues });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
