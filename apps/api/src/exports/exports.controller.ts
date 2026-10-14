import { Controller, Get, Param, Res } from '@nestjs/common';
import { type Response } from 'express';
import { ActorTypes, type ExportJob } from '@iace/contracts';
import { ExportJobsService, sendWorkbook } from '../common/exporting';
import { Actors, CurrentUser, RequiresExport, type AuthenticatedUser } from '../common/security';

/** Where an asked-for file is waited on and collected. Only its asker sees either. */
@Controller('admin/exports')
@Actors(ActorTypes.ADMIN)
@RequiresExport()
export class ExportsController {
  constructor(private readonly exportJobs: ExportJobsService) {}

  @Get(':id')
  job(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<ExportJob> {
    return this.exportJobs.status(id, user.id);
  }

  @Get(':id/file')
  async file(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { kind, workbook } = await this.exportJobs.file(id, user.id);
    sendWorkbook(response, kind, workbook);
  }
}
