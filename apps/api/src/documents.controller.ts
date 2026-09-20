import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  calendarRequestSchema,
  createDocumentSchema,
  draftRequestSchema,
} from '@lexilens/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequireScope, RequireScopeGuard } from './auth/require-scope.guard';
import { type AuthPrincipal, CurrentPrincipal, IdentityGuard } from './auth/identity';
import { loadConfig } from './config';
import { DocumentService } from './documents.service';
import { ExtractionService } from './extraction.service';
import { ExtractionWorkerService } from './extraction-worker.service';
import { CleanupReconcilerService } from './cleanup-reconciler.service';
import { UploadService } from './uploads.service';
import { PERSISTENCE_PORT, type PersistencePort } from './persistence/persistence.port';

const config = loadConfig();

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort) {}
  @Get()
  async status() {
    const persistence = await this.persistence.health();
    if (!persistence.healthy)
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'lexilens-api',
        authMode: config.AUTH_MODE,
        persistence: { mode: persistence.mode, schemaVersion: persistence.schemaVersion },
      });
    return {
      status: 'ok' as const,
      service: 'lexilens-api',
      authMode: config.AUTH_MODE,
      persistence: { mode: persistence.mode, schemaVersion: persistence.schemaVersion },
    };
  }
}

@ApiTags('documents')
@ApiBearerAuth('oidc')
@ApiHeader({
  name: 'x-local-session-id',
  required: false,
  description: 'Development/test-only UUID used only with loopback AUTH_MODE=local.',
})
@UseGuards(IdentityGuard, RequireScopeGuard)
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentService,
    private readonly uploads: UploadService,
    private readonly extraction: ExtractionService,
    private readonly worker: ExtractionWorkerService,
    private readonly cleanup: CleanupReconcilerService,
  ) {}

  @Get()
  @RequireScope('documents:read')
  async list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.documents.list(principal.ownerId);
  }

  @Post('uploads')
  @HttpCode(201)
  @RequireScope('documents:write')
  @ApiOperation({
    summary: 'Privately upload one production-supported text file for quarantine scanning',
  })
  async upload(@CurrentPrincipal() principal: AuthPrincipal, @Req() request: FastifyRequest) {
    const multipart = await request.file();
    if (!multipart) throw new BadRequestException('Exactly one file is required.');
    const fields = multipart.fields as Record<string, { value?: unknown } | undefined>;
    const title = typeof fields.title?.value === 'string' ? fields.title.value.trim() : '';
    if (!title || title.length > 180)
      throw new BadRequestException('A title between 1 and 180 characters is required.');
    if (await request.file()) throw new BadRequestException('Exactly one file is required.');
    return this.uploads.upload(principal.ownerId, {
      title,
      filename: multipart.filename,
      mimeType: multipart.mimetype,
      stream: multipart.file,
    });
  }

  @Post()
  @HttpCode(201)
  @RequireScope('documents:write')
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (parsed.data.text.length > config.MAX_TEXT_CHARACTERS)
      throw new BadRequestException(
        `Document text exceeds the configured ${config.MAX_TEXT_CHARACTERS} character limit.`,
      );
    return this.documents.create(principal.ownerId, parsed.data);
  }

  @Get(':id')
  @RequireScope('documents:read')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.documents.get(principal.ownerId, id);
  }

  @Delete(':id')
  @RequireScope('documents:write')
  async delete(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.documents.delete(principal.ownerId, id);
  }

  /** Internal-only bounded worker boundary. It remains scope-gated and is not a public scheduler. */
  @Post('reconcile-extraction')
  @RequireScope('documents:write')
  async reconcileExtractionLeases() {
    return this.worker.reconcileExpiredLeases();
  }

  @Post('reconcile-cleanup')
  @RequireScope('documents:write')
  async reconcileCleanup() {
    return this.cleanup.reconcile();
  }

  @Post(':id/extraction')
  @RequireScope('documents:write')
  async extract(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    const document = await this.extraction.process(principal.ownerId, id);
    if (!document)
      throw new NotFoundException('Document is not ready for extraction or is unavailable.');
    const {
      ownerId: _owner,
      sourceText: _text,
      contentHash: _hash,
      storageKey: _key,
      extractionArtifact: _artifact,
      extractionFailure: _failure,
      extractionLeaseId: _lease,
      extractionLeaseExpiresAt: _expiry,
      ...metadata
    } = document;
    return metadata;
  }

  @Post(':id/drafts')
  @RequireScope('documents:read')
  async draft(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = draftRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.documents.createDraft(principal.ownerId, id, parsed.data);
  }

  @Post(':id/calendar')
  @RequireScope('documents:read')
  async calendar(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = calendarRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    reply.type('text/calendar; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="lexilens-${id}.ics"`);
    return this.documents.createCalendar(principal.ownerId, id, parsed.data);
  }
}
