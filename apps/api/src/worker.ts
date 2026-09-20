import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MaintenanceWorkerService } from './maintenance-worker.service';

/** One-shot process entrypoint. Deliberately creates an application context, not an HTTP listener. */
export async function runMaintenanceOnce(worker: Pick<MaintenanceWorkerService, 'runOnce'>) {
  return worker.runOnce();
}

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const result = await runMaintenanceOnce(context.get(MaintenanceWorkerService));
    console.log(JSON.stringify({ event: 'maintenance.complete', result }));
  } finally {
    await context.close();
  }
}

void bootstrap().catch((error: unknown) => {
  console.error('maintenance worker failed', error);
  process.exitCode = 1;
});
