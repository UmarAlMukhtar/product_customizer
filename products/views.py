from django.http import JsonResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import render
from django.core.files.storage import default_storage
from .models import ProductView, CustomizationRequest, Product
from .image_processor import process_and_save
import json
import os
from django.conf import settings
import zipfile
import io


def _parse_float(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def frontend(request):
    return render(request, 'products/index.html')


def product_views(request):
    """Get all product views for display"""
    views = ProductView.objects.select_related('product').order_by('product__name', 'angle')
    data = [
        {
            'id': view.id,
            'product_id': view.product_id,
            'product_name': view.product.name,
            'angle': view.angle,
            'color': view.color,
            'base_image_url': view.base_image.url,
            'print_area': {
                'x': view.print_area_x,
                'y': view.print_area_y,
                'width': view.print_area_width,
                'height': view.print_area_height,
            },
        }
        for view in views
    ]
    return JsonResponse({'items': data})


@csrf_exempt
def generate_catalog(request):
    """Generate customizations for all product views with a design"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST only'}, status=405)

    design_file = request.FILES.get('design')
    if not design_file:
        return JsonResponse({'error': 'design file is required'}, status=400)

    try:
        from .image_processor import upload_to_freeimage
        design_url = upload_to_freeimage(design_file.read(), design_file.name)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({'error': f'Failed to upload design to Freeimage: {str(e)}'}, status=500)

    requested_color = (request.POST.get('color') or '#ffffff').strip().lower()
    if requested_color not in {'#ffffff', '#000000'}:
        requested_color = '#ffffff'

    transform = {
        'move_x': _parse_float(request.POST.get('move_x'), 0.0),
        'move_y': _parse_float(request.POST.get('move_y'), 0.0),
        'scale': _parse_float(request.POST.get('scale'), 1.0),
        'rotation_deg': _parse_float(request.POST.get('rotation_deg'), 0.0),
    }

    # Only generate the selected color variant.
    all_views = ProductView.objects.select_related('product').filter(
        color__iexact=requested_color,
    )

    # Optionally filter by specific product IDs (from the product filter checkboxes).
    product_ids_raw = request.POST.get('product_ids', '').strip()
    if product_ids_raw:
        try:
            product_ids = [int(pid) for pid in product_ids_raw.split(',') if pid.strip()]
            all_views = all_views.filter(product_id__in=product_ids)
        except ValueError:
            pass  # ignore malformed input, generate all

    all_views = list(all_views.order_by('product__name', 'angle'))
    total_views = len(all_views)
    
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from django.http import StreamingHttpResponse
    import json

    def process_single_view(product_view):
        try:
            # Create customization request
            req = CustomizationRequest.objects.create(
                product_view=product_view,
                user_design_url=design_url
            )
            
            # Process the image
            process_and_save(req, transform=transform)
            
            return {
                'customization_request_id': req.id,
                'product_view_id': product_view.id,
                'product_name': product_view.product.name,
                'angle': product_view.angle,
                'color': product_view.color,
                'base_image_url': product_view.base_image.url,
                'print_area': {
                    'x': product_view.print_area_x,
                    'y': product_view.print_area_y,
                    'width': product_view.print_area_width,
                    'height': product_view.print_area_height,
                },
                'result_image_url': req.result_image_url or (req.result_image.url if req.result_image else ''),
                'success': True
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {
                'product_view_id': product_view.id,
                'product_name': product_view.product.name,
                'angle': product_view.angle,
                'color': product_view.color,
                'base_image_url': product_view.base_image.url,
                'print_area': {
                    'x': product_view.print_area_x,
                    'y': product_view.print_area_y,
                    'width': product_view.print_area_width,
                    'height': product_view.print_area_height,
                },
                'success': False,
                'error': str(e)
            }

    def event_stream():
        yield json.dumps({"status": "start", "total": total_views}) + "\n"
        
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_to_view = {executor.submit(process_single_view, view): view for view in all_views}
            completed = 0
            for future in as_completed(future_to_view):
                completed += 1
                result = future.result()
                yield json.dumps({
                    "status": "progress", 
                    "completed": completed, 
                    "total": total_views, 
                    "result": result
                }) + "\n"
                
    return StreamingHttpResponse(event_stream(), content_type='application/x-ndjson')

@csrf_exempt
def customize(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST only'}, status=405)

    product_view_id = request.POST.get('product_view_id')
    design_file = request.FILES.get('design')

    if not product_view_id or not design_file:
        return JsonResponse({'error': 'product_view_id and design are required'}, status=400)

    try:
        product_view = ProductView.objects.get(id=product_view_id)
    except ProductView.DoesNotExist:
        return JsonResponse({'error': 'Product view not found'}, status=404)

    transform = {
        'move_x': _parse_float(request.POST.get('move_x'), 0.0),
        'move_y': _parse_float(request.POST.get('move_y'), 0.0),
        'scale': _parse_float(request.POST.get('scale'), 1.0),
        'rotation_deg': _parse_float(request.POST.get('rotation_deg'), 0.0),
    }

    try:
        from .image_processor import upload_to_freeimage
        design_url = upload_to_freeimage(design_file.read(), design_file.name)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({'error': f'Failed to upload design to Freeimage: {str(e)}'}, status=500)

    # Save the customization request
    req = CustomizationRequest.objects.create(
        product_view=product_view,
        user_design_url=design_url
    )

    # Process the image
    result_path = process_and_save(req, transform=transform)

    return JsonResponse({
        'success': True,
        'result_image_url': req.result_image_url or (req.result_image.url if req.result_image else ''),
        'request_id': req.id
    })


def download_customization(request, request_id):
    """Download a single customized product"""
    try:
        customization = CustomizationRequest.objects.select_related(
            'product_view__product'
        ).get(id=request_id)
    except CustomizationRequest.DoesNotExist:
        return JsonResponse({'error': 'Customization not found'}, status=404)

    image_url = customization.result_image_url or (customization.result_image.url if customization.result_image else None)
    if not image_url:
        return JsonResponse({'error': 'Result image not ready'}, status=400)

    filename = f"{customization.product_view.product.name}_{customization.product_view.angle}.png"

    if image_url.startswith('http://') or image_url.startswith('https://'):
        import requests
        resp = requests.get(image_url)
        if resp.status_code == 200:
            response = FileResponse(io.BytesIO(resp.content), content_type='image/png')
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
            return response
        else:
            return JsonResponse({'error': 'Failed to fetch result image'}, status=500)
    else:
        # FileResponse accepts an open file and closes it automatically.
        response = FileResponse(
            open(customization.result_image.path, 'rb'),
            content_type='image/png',
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


@csrf_exempt
def download_batch(request):
    """Download multiple customizations as ZIP"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST only'}, status=405)

    try:
        data = json.loads(request.body)
        request_ids = data.get('request_ids', [])
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    if not request_ids:
        return JsonResponse({'error': 'request_ids required'}, status=400)

    # Fetch all customizations
    customizations = CustomizationRequest.objects.select_related(
        'product_view__product'
    ).filter(id__in=request_ids)
    
    if not customizations.exists():
        return JsonResponse({'error': 'No customizations found'}, status=404)

    # Create ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for customization in customizations:
            image_url = customization.result_image_url or (customization.result_image.url if customization.result_image else None)
            if image_url:
                filename = f"{customization.product_view.product.name}_{customization.product_view.angle}.png"
                if image_url.startswith('http://') or image_url.startswith('https://'):
                    import requests
                    resp = requests.get(image_url)
                    if resp.status_code == 200:
                        zip_file.writestr(filename, resp.content)
                else:
                    file_path = customization.result_image.path
                    zip_file.write(file_path, arcname=filename)

    zip_buffer.seek(0)
    response = FileResponse(zip_buffer, content_type='application/zip')
    response['Content-Disposition'] = 'attachment; filename="customizations.zip"'
    return response


@csrf_exempt
def edit_customization(request, request_id):
    """Update transforms for an existing customization"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST only'}, status=405)

    try:
        customization = CustomizationRequest.objects.get(id=request_id)
    except CustomizationRequest.DoesNotExist:
        return JsonResponse({'error': 'Customization not found'}, status=404)

    requested_product_view_id = request.POST.get('product_view_id')
    requested_color = (request.POST.get('color') or '').strip().lower()

    if requested_product_view_id:
        try:
            new_view = ProductView.objects.select_related('product').get(id=requested_product_view_id)
        except ProductView.DoesNotExist:
            return JsonResponse({'error': 'Selected product view not found'}, status=404)
        customization.product_view = new_view
        customization.save(update_fields=['product_view'])
    elif requested_color:
        current_view = customization.product_view
        if requested_color != current_view.color.lower():
            replacement = ProductView.objects.filter(
                product_id=current_view.product_id,
                angle=current_view.angle,
                color__iexact=requested_color,
            ).first()
            if not replacement:
                return JsonResponse({'error': 'No product view found for selected color'}, status=400)
            customization.product_view = replacement
            customization.save(update_fields=['product_view'])

    transform = {
        'move_x': _parse_float(request.POST.get('move_x'), 0.0),
        'move_y': _parse_float(request.POST.get('move_y'), 0.0),
        'scale': _parse_float(request.POST.get('scale'), 1.0),
        'rotation_deg': _parse_float(request.POST.get('rotation_deg'), 0.0),
    }

    # Reprocess with new transforms
    process_and_save(customization, transform=transform)

    cache_busted_url = customization.result_image_url or (customization.result_image.url if customization.result_image else '')
    
    # Cache busting for local files, not needed for unique freeimage host urls
    if not cache_busted_url.startswith('http://') and not cache_busted_url.startswith('https://'):
        try:
            cache_busted_url = f"{cache_busted_url}?v={int(os.path.getmtime(customization.result_image.path))}"
        except (OSError, ValueError):
            pass

    return JsonResponse({
        'success': True,
        'result_image_url': cache_busted_url,
        'product_view': {
            'id': customization.product_view.id,
            'product_id': customization.product_view.product_id,
            'product_name': customization.product_view.product.name,
            'angle': customization.product_view.angle,
            'color': customization.product_view.color,
            'base_image_url': customization.product_view.base_image.url,
            'print_area': {
                'x': customization.product_view.print_area_x,
                'y': customization.product_view.print_area_y,
                'width': customization.product_view.print_area_width,
                'height': customization.product_view.print_area_height,
            },
        }
    })