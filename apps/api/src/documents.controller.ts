import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  calendarRequestSchema,
  createDocumentSchema,
  draftRequestSchema,
} from '@lexilens/contracts';
import type { FastifyReply } from 'fastify';
import { loadConfig } from './config';
import { DocumentService } from './documents.service';

const config = loadConfig();

function ownerFromHeader(value: string | undefined): string {
  const parsed = value ? /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) : false;
  if (!parsed) throw new UnauthorizedException('A valid local session identity is required.');
  return value!;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  status(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'lexilens-api' };
  }
}

@ApiTags('documents')
@ApiHeader({ name: 'x-local-session-id', required: true, description: 'Random local-development session ID; replace with OIDC in production.' })
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentService) {}

  @Get()
  @ApiOperation({ summary: 'List documents owned by the local session' })
  list(@Headers('x-local-session-id') ownerId?: string) {
    return this.documents.list(ownerFromHeader(ownerId));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Submit raw text for validated consumer-document screening' })
  create(@Headers('x-local-session-id') ownerId: string | undefined, @Body() body: unknown) {
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (parsed.data.text.length > config.MAX_TEXT_CHARACTERS) {
      throw new BadRequestException(`Document text exceeds the configured ${config.MAX_TEXT_CHARACTERS} character limit.`);
    }
    return this.documents.create(ownerFromHeader(ownerId), parsed.data);
  }

  @Get(':id')
  get(@Headers('x-local-session-id') ownerId: string | undefined, @Param('id') id: string) {
    return this.documents.get(ownerFromHeader(ownerId), id);
  }

  @Delete(':id')
  delete(@Headers('x-local-session-id') ownerId: string | undefined, @Param('id') id: string) {
    return this.documents.delete(ownerFromHeader(ownerId), id);
  }

  @Post(':id/drafts')
  draft(
    @Headers('x-local-session-id') ownerId: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = draftRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.documents.createDraft(ownerFromHeader(ownerId), id, parsed.data);
  }

  @Post(':id/calendar')
  calendar(
    @Headers('x-local-session-id') ownerId: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = calendarRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    reply.type('text/calendar; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="lexilens-${id}.ics"`);
    return this.documents.createCalendar(ownerFromHeader(ownerId), id, parsed.data);
  }
}
