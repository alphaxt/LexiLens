import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  calendarRequestSchema,
  createDocumentSchema,
  draftRequestSchema,
} from '@lexilens/contracts';
import type { FastifyReply } from 'fastify';
import { type AuthPrincipal, CurrentPrincipal, IdentityGuard } from './auth/identity';
import { loadConfig } from './config';
import { DocumentService } from './documents.service';

const config = loadConfig();

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  status(): { status: 'ok'; service: string; authMode: 'local' | 'oidc' } {
    return { status: 'ok', service: 'lexilens-api', authMode: config.AUTH_MODE };
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
  constructor(private readonly documents: DocumentService) {}

  @Get()
  @ApiOperation({ summary: 'List documents owned by the authenticated principal' })
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.documents.list(principal.ownerId);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Submit raw text for validated consumer-document screening' })
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
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
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.documents.get(principal.ownerId, id);
  }

  @Delete(':id')
  delete(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.documents.delete(principal.ownerId, id);
  }

  @Post(':id/drafts')
  draft(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = draftRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.documents.createDraft(principal.ownerId, id, parsed.data);
  }

  @Post(':id/calendar')
  calendar(
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
