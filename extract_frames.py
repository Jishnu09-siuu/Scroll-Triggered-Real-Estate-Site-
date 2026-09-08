import cv2
import os
import shutil
import time
import numpy as np
from concurrent.futures import ThreadPoolExecutor

VIDEO_PATH = 'videoplayback.webm'
OUTPUT_DIR = 'frames'
START_FRAME = 0
END_FRAME = 800  # The exact earlier sequence
TARGET_WIDTH = 1920
TARGET_HEIGHT = 1080
QUALITY = 80  # Crisp visual quality + fast loading
INTERPOLATE_2X = True  # Double frame rate for ultra-smooth 60fps scrolling

cap = cv2.VideoCapture(VIDEO_PATH)

if os.path.exists(OUTPUT_DIR):
    shutil.rmtree(OUTPUT_DIR)
os.makedirs(OUTPUT_DIR, exist_ok=True)

native_count = (END_FRAME - START_FRAME) + 1
total_target = (native_count * 2 - 1) if INTERPOLATE_2X else native_count

print(f"Extracting earlier clip (frames {START_FRAME} to {END_FRAME})...")
print(f"Generating {total_target} high-density frames ({TARGET_WIDTH}x{TARGET_HEIGHT}, WebP Quality {QUALITY})...")
t0 = time.time()

def write_image(args):
    path, img = args
    cv2.imwrite(path, img, [cv2.IMWRITE_WEBP_QUALITY, QUALITY])

pool = ThreadPoolExecutor(max_workers=8)
current_frame = 0
saved = 0
futures = []
prev_frame = None

while current_frame <= END_FRAME:
    ret, frame = cap.read()
    if not ret:
        break
    
    if current_frame >= START_FRAME:
        resized = cv2.resize(frame, (TARGET_WIDTH, TARGET_HEIGHT), interpolation=cv2.INTER_AREA)
        
        # If 2x interpolation is enabled and we have a previous frame, insert intermediate blend
        if INTERPOLATE_2X and prev_frame is not None:
            saved += 1
            # 50/50 weighted blend for silky smooth in-between transition
            blended = cv2.addWeighted(prev_frame, 0.5, resized, 0.5, 0)
            out_path = os.path.join(OUTPUT_DIR, f"frame_{saved:04d}.webp")
            futures.append(pool.submit(write_image, (out_path, blended)))
        
        saved += 1
        out_path = os.path.join(OUTPUT_DIR, f"frame_{saved:04d}.webp")
        futures.append(pool.submit(write_image, (out_path, resized)))
        
        prev_frame = resized
        
        if saved % 200 == 0:
            print(f"Processed & queued {saved}/{total_target} frames ({saved/total_target*100:.1f}%)...")

    current_frame += 1

cap.release()
print(f"Finalizing disk writes for {saved} frames...")
for f in futures:
    f.result()
pool.shutdown()

print(f"Done! Successfully generated {saved} ultra-smooth frames in {time.time() - t0:.1f}s.")
