#!/bin/sh
# Renders the hero loop (12 s, 1280x720, 30 fps) from code and encodes it into assets/video/.
#   pip install pillow numpy scipy   (and ffmpeg)
#   sh tools/hero-video/render.sh
set -e
cd "$(dirname "$0")"
OUT=../../assets/video
python3 -B scene.py | ffmpeg -v error -y -f rawvideo -pix_fmt rgb24 -s 1280x720 -r 30 -i - \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p /tmp/hero-master.mp4
ffmpeg -v error -y -i /tmp/hero-master.mp4 -an -c:v libx264 -preset slow -crf 24 -profile:v high -pix_fmt yuv420p -movflags +faststart $OUT/hero.mp4
ffmpeg -v error -y -i /tmp/hero-master.mp4 -an -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 $OUT/hero.webm
ffmpeg -v error -y -i /tmp/hero-master.mp4 -frames:v 1 -q:v 4 $OUT/hero-poster.jpg
echo "assets/video: hero.mp4, hero.webm, hero-poster.jpg"
