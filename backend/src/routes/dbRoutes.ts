import { Router, Request, Response } from 'express';
import { ConfigStore } from '../store/ConfigStore';
import { MysqlService } from '../services/MysqlService';

export function createDbRoutes(configStore: ConfigStore, mysqlService: MysqlService): Router {
  const router = Router();

  router.get('/configs/:id/db-preview', async (req: Request, res: Response) => {
    const config = await configStore.getConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Config not found' });
    try {
      const rows = await mysqlService.readTable(config);
      const columns = await mysqlService.getTableColumns(config);
      res.json({ columns, rows });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
