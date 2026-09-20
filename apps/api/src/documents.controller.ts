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
import { RequireScopeGuard } from './auth/require-scope.guard';
import { type AuthPrincipal, CurrentPrincipal, IdentityGuard } from './auth/identity';
import { loadConfig } from './config';
import { DocumentService } from './documents.service';
import { ExtractionService } from './extraction.service';
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
    if (!persistence.healthy) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'lexilens-api',
        authMode: config.AUTH_MODE,
        persistence: {
          mode: persistence.mode,
          schemaVersion: persistence.schemaVersion,
        },
      });
    }
    return {
      status: 'ok' as const,
      service: 'lexilens-api',
      authMode: config.AUTH_MODE,
      persistence: {
        mode: persistence.mode,
        schemaVersion: persistence.schemaVersion,
      },
    };
  }
}

@ApiTags('documents')
@ApiBearerAuth('oidc')
@ApiHeader({
  name: 'x-local-session-id',
  required: false,
  description: 'Development-only UUID used when AUTH_MODE=local. Never production authentication.',
})
@UseGuards(IdentityGuard)
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentService,
    private readonly uploads: UploadService,
    private readonly extraction: ExtractionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List documents owned by the authenticated principal' })
  async list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.documents.list(principal.ownerId);
  }

  @Post('uploads')
  @HttpCode(201)
  @UseGuards(RequireScopeGuard)
  @ApiOperation({ summary: 'Privately upload one file for quarantine scanning' })
  async upload(@CurrentPrincipal() principal: AuthPrincipal, @Req() request: FastifyRequest) {
    const multipart = await request.file();
    if (!multipart) throw new BadRequestException('Exactly one file is required.');
    const fields = multipart.fields as Record<string, { value?: unknown } | undefined>;
    const title = typeof fields.title?.value === 'string' ? fields.title.value.trim() : '';
    if (!title || title.length > 180)
      throw new BadRequestException('A title between 1 and 180 characters is required.');
    const second = await request.file();
    if (second) throw new BadRequestException('Exactly one file is required.');
    return this.uploads.upload(principal.ownerId, {
      title,
      filename: multipart.filename,
      mimeType: multipart.mimetype,
      stream: multipart.file,
    });
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Submit raw text for validated consumer-document screening' })
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (parsed.data.text.length > config.MAX_TEXT_CHARACTERS) {
      throw new BadRequestException(
        `Document text exceeds the configured ${config.MAX_TEXT_CHARACTERS} character limit.`,
      );
    }
    return this.documents.create(principal.ownerId, parsed.data);
  }

  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.documents.get(principal.ownerId, id);
  }

  @Delete(':id')
  async delete(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.documents.delete(principal.ownerId, id);
  }

  @Post(':id/extraction')
  @UseGuards(RequireScopeGuard)
  @ApiOperation({ summary: 'Request safe extraction processing for one owned, clean upload' })
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
