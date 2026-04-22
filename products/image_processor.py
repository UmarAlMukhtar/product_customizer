import cv2
import numpy as np
from PIL import Image
import os
import gc

# Maximum pixel dimension for any image loaded into memory.
# Keeps peak RAM well under Render's 512 MB free-tier limit.
MAX_DIMENSION = 1200


def _downscale(img, max_dim=MAX_DIMENSION):
    """Downscale a PIL image so its largest side is at most *max_dim* pixels."""
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    ratio = max_dim / max(w, h)
    return img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)


def _downscale_cv(img, max_dim=MAX_DIMENSION):
    """Downscale an OpenCV (numpy) image so its largest side is at most *max_dim* pixels."""
    h, w = img.shape[:2]
    if max(w, h) <= max_dim:
        return img
    ratio = max_dim / max(w, h)
    return cv2.resize(img, (int(w * ratio), int(h * ratio)), interpolation=cv2.INTER_AREA)


def apply_design_to_product(product_view, design_image_path, transform=None):
    transform = transform or {}

    # Load base product image
    base_path = product_view.base_image.path
    base_img = cv2.imread(base_path)
    if base_img is None:
        raise FileNotFoundError(
            f"Base image not found: {base_path} — re-upload the product image via the admin panel."
        )
    original_h, original_w = base_img.shape[:2]
    base_img = _downscale_cv(base_img)
    base_h, base_w = base_img.shape[:2]

    # Load user design
    design = Image.open(design_image_path).convert('RGBA')
    design = _downscale(design)

    # ✅ Auto-remove white background
    design = remove_background(design)
    
    # Get print area — scale coords to match the (possibly downscaled) base image
    coord_scale = base_w / original_w if original_w != base_w else 1.0

    px = int(product_view.print_area_x * coord_scale)
    py = int(product_view.print_area_y * coord_scale)
    pw = int(product_view.print_area_width * coord_scale)
    ph = int(product_view.print_area_height * coord_scale)

    # Clamp print area to image bounds
    px = max(0, min(px, base_w - 1))
    py = max(0, min(py, base_h - 1))
    pw = min(pw, base_w - px)
    ph = min(ph, base_h - py)

    # ✅ Resize keeping aspect ratio — fit inside print area
    design_w, design_h = design.size
    ratio = min(pw / design_w, ph / design_h)
    new_w = int(design_w * ratio)
    new_h = int(design_h * ratio)
    design_resized = design.resize((new_w, new_h), Image.LANCZOS)
    del design  # free original

    scale = max(0.2, min(float(transform.get('scale', 1.0)), 4.0))
    # CSS preview uses clockwise-positive rotation; Pillow is counterclockwise-positive.
    # Negate so saved output matches the on-screen edit preview direction.
    rotation_deg = -float(transform.get('rotation_deg', 0.0))

    # Movement is expressed in pixels so it matches the edit modal sliders and
    # the live preview. Clamp it to the print area size to keep the artwork on
    # the product surface.
    move_x = max(-pw, min(float(transform.get('move_x', 0.0)), pw))
    move_y = max(-ph, min(float(transform.get('move_y', 0.0)), ph))

    scaled_w = max(1, int(new_w * scale))
    scaled_h = max(1, int(new_h * scale))
    design_transformed = design_resized.resize((scaled_w, scaled_h), Image.LANCZOS)
    del design_resized  # free intermediate

    # Rotate with transparency, preserving full bounds.
    design_transformed = design_transformed.rotate(rotation_deg, expand=True, resample=Image.BICUBIC)
    transformed_w, transformed_h = design_transformed.size

    # Center relative to the print area, then apply pixel offsets.
    center_x = px + (pw / 2.0) + move_x
    center_y = py + (ph / 2.0) + move_y

    offset_x = int(center_x - transformed_w / 2.0)
    offset_y = int(center_y - transformed_h / 2.0)

    # Apply displacement map using the actual resized dimensions
    design_warped, warped_x, warped_y = apply_displacement_map(base_img, design_transformed, offset_x, offset_y)
    del design_transformed  # free intermediate

    # Blend onto base
    result = blend_design_onto_base(base_img, design_warped, warped_x, warped_y)
    del base_img, design_warped  # free large arrays
    gc.collect()

    return result

def remove_background(design_pil):
    """
    Auto-removes white or near-white background from design
    Works even if the image has no transparency
    """
    design = design_pil.convert('RGBA')
    data = np.array(design)  # uint8 — no float32 copy needed here

    r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]

    # Detect near-white pixels (all channels > 230)
    white_mask = (r > 230) & (g > 230) & (b > 230)

    # Make those pixels transparent
    data[:,:,3] = np.where(white_mask, 0, a)

    result = Image.fromarray(data, 'RGBA')
    del data, white_mask  # free arrays
    return result

def apply_displacement_map(base_img, design_pil, px, py):
    base_h, base_w = base_img.shape[:2]
    design_w, design_h = design_pil.size

    x1 = max(0, px)
    y1 = max(0, py)
    x2 = min(base_w, px + design_w)
    y2 = min(base_h, py + design_h)

    if x1 >= x2 or y1 >= y2:
        return None, 0, 0

    crop_left = x1 - px
    crop_top = y1 - py
    crop_right = crop_left + (x2 - x1)
    crop_bottom = crop_top + (y2 - y1)

    clipped_design = design_pil.crop((crop_left, crop_top, crop_right, crop_bottom))

    # Crop target region from base image where the design will be blended.
    roi = base_img[y1:y2, x1:x2]
    actual_h, actual_w = roi.shape[:2]

    # Resize design to exactly match ROI (safety measure)
    design_pil = clipped_design.resize((actual_w, actual_h), Image.LANCZOS)
    del clipped_design

    # Grayscale for displacement detection
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (21, 21), 0)
    del gray

    # Displacement strength: -8 to +8 pixels
    disp = (blur.astype(np.float32) - 128) / 128.0 * 8
    del blur

    design_np = np.array(design_pil).astype(np.float32)
    del design_pil

    h, w = disp.shape
    map_x = np.tile(np.arange(w), (h, 1)).astype(np.float32) + disp
    map_y = np.tile(np.arange(h), (w, 1)).T.astype(np.float32) + disp
    del disp

    map_x = np.clip(map_x, 0, w - 1)
    map_y = np.clip(map_y, 0, h - 1)

    warped_channels = []
    for c in range(design_np.shape[2]):
        warped = cv2.remap(design_np[:, :, c], map_x, map_y,
                           interpolation=cv2.INTER_LINEAR)
        warped_channels.append(warped)
    del design_np, map_x, map_y

    warped_np = np.stack(warped_channels, axis=2).astype(np.uint8)
    del warped_channels
    return Image.fromarray(warped_np, 'RGBA'), x1, y1


def blend_design_onto_base(base_img, design_pil, px, py):
    base_pil = Image.fromarray(cv2.cvtColor(base_img, cv2.COLOR_BGR2RGB)).convert('RGBA')

    if design_pil is None:
        return base_pil

    # Crop the exact region from base
    roi_pil = base_pil.crop((px, py, px + design_pil.width, py + design_pil.height))

    design_rgb = design_pil.convert('RGB')
    design_alpha = design_pil.split()[3]

    roi_np = np.array(roi_pil.convert('RGB')).astype(np.float32)
    design_np = np.array(design_rgb.resize(
        (roi_np.shape[1], roi_np.shape[0]), Image.LANCZOS
    )).astype(np.float32)
    del design_rgb, roi_pil

    # Multiply blend (fabric texture/shadows)
    multiplied = (design_np * roi_np / 255.0).astype(np.float32)

    # ✅ Blend strength: 0.0 = fully original design, 1.0 = fully multiplied
    # 0.3 means 30% fabric texture, 70% original design color
    BLEND_STRENGTH = 0.3
    blended_np = ((1 - BLEND_STRENGTH) * design_np + BLEND_STRENGTH * multiplied).astype(np.uint8)
    del design_np, roi_np, multiplied

    blended_pil = Image.fromarray(blended_np).convert('RGBA')
    del blended_np

    # Resize alpha to match
    design_alpha = design_alpha.resize((blended_pil.width, blended_pil.height))

    base_pil.paste(blended_pil, (px, py), mask=design_alpha)
    del blended_pil, design_alpha
    return base_pil


def process_and_save(customization_request, transform=None):
    from django.conf import settings

    product_view = customization_request.product_view
    design_path = customization_request.user_design.path

    result_image = apply_design_to_product(product_view, design_path, transform=transform)

    result_filename = f'result_{customization_request.id}.png'
    result_path = os.path.join(settings.MEDIA_ROOT, 'results', result_filename)
    os.makedirs(os.path.dirname(result_path), exist_ok=True)
    result_image.save(result_path, optimize=True)
    del result_image
    gc.collect()

    customization_request.result_image = f'results/{result_filename}'
    customization_request.save()

    return result_path