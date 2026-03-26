'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const os = require('os');
const logger = require('../utils/logger');

/**
 * Renders a full MP4 video for a given story by stitching scenes.
 * 
 * @param {Object} story
 * @returns {Promise<string>} - Path to the generated .mp4 file
 */
async function packageStoryVideo(story) {
  const tmpDir = path.join(os.tmpdir(), `storyvista_render_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const finalOutput = path.join(tmpDir, 'packaged_story.mp4');
  const command = ffmpeg();

  try {
    for (let i = 0; i < story.scenes.length; i++) {
        const scene = story.scenes[i];
        
        // 1. Download image and audio for this scene
        const imgPath = path.join(tmpDir, `image_${i}.jpg`);
        const audPath = path.join(tmpDir, `audio_${i}.mp3`);
        
        const imgRes = await axios.get(scene.media?.url || 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=1200', { responseType: 'stream' });
        imgRes.data.pipe(fs.createWriteStream(imgPath));
        await new Promise((resolve) => imgRes.data.on('end', resolve));

        const audRes = await axios.get(scene.audioUrl, { responseType: 'stream' });
        audRes.data.pipe(fs.createWriteStream(audPath));
        await new Promise((resolve) => audRes.data.on('end', resolve));

        // 2. Add as input
        // Since we want to display the image while the audio plays, we loop the image
        command
           .input(imgPath)
           .loop()
           .input(audPath)
           .complexFilter([
             `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1[v]`,
             `[v]drawtext=text='${scene.title}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-100:shadowcolor=black:shadowx=2:shadowy=2[v_final]`
           ])
           .map('[v_final]')
           .map('1:a');
    }

    // FFmpeg stitching for complex multi-input is tricky.
    // A simpler way for a story is to render slides individually and then concat or 
    // use a specific concat filter.
    
    // For now, let's keep it simple: Render a single merged MP4.
    // This is a placeholder for the full FFmpeg logic which will be refined.
    
    return new Promise((resolve, reject) => {
      command
        .output(finalOutput)
        .on('end', () => resolve(finalOutput))
        .on('error', (err) => reject(err))
        .run();
    });

  } catch (err) {
    logger.error(`[Packager] Failed to package video: ${err.message}`);
    throw err;
  }
}

module.exports = { packageStoryVideo };
