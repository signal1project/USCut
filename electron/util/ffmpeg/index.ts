/*
 * @Author: nevin
 * @Date: 2025-02-14 16:36:05
 * @LastEditTime: 2025-02-23 20:07:52
 * @LastEditors: nevin
 * @Description: ffmpeg工具
 */
import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath, resolveFfprobePath } from '../ffmpegBinary';

ffmpeg.setFfmpegPath(resolveFfmpegPath());
ffmpeg.setFfprobePath(resolveFfprobePath());
export default class FFmpeg {
  ffmpeg: ffmpeg.FfmpegCommand;

  constructor(inputPath: string) {
    this.ffmpeg = ffmpeg(inputPath);
  }
}
