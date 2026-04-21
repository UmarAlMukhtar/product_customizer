from PIL import Image, ImageDraw

# ---- TWEAK THESE VALUES ----
IMAGE_PATH = "Your Image Path Here"
X      = 130
Y      = 120
WIDTH  = 240
HEIGHT = 400
# ----------------------------

img = Image.open(IMAGE_PATH).convert('RGBA')
draw = ImageDraw.Draw(img)

# Draw rectangle border
draw.rectangle(
    [X, Y, X + WIDTH, Y + HEIGHT],
    outline='red',
    width=1
)

# Draw corner markers so you can see exact edges
dot = 6
draw.ellipse([X-dot, Y-dot, X+dot, Y+dot], fill='red')           # top-left
draw.ellipse([X+WIDTH-dot, Y-dot, X+WIDTH+dot, Y+dot], fill='red')  # top-right
draw.ellipse([X-dot, Y+HEIGHT-dot, X+dot, Y+HEIGHT+dot], fill='red')  # bottom-left
draw.ellipse([X+WIDTH-dot, Y+HEIGHT-dot, X+WIDTH+dot, Y+HEIGHT+dot], fill='red')  # bottom-right

# Save and open
out = "debug_output.png"
img.save(out)
print(f"Saved: {out}")

# Auto-open the image
import os
os.startfile(out)