from django.contrib import admin
from .models import Product, ProductView, CustomizationRequest

@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ['name', 'created_at']

@admin.register(ProductView)
class ProductViewAdmin(admin.ModelAdmin):
    list_display = ['product', 'angle', 'color', 'print_area_x', 'print_area_y', 'print_area_width', 'print_area_height']

@admin.register(CustomizationRequest)
class CustomizationRequestAdmin(admin.ModelAdmin):
    list_display = ['id', 'product_view', 'created_at']
    readonly_fields = ['result_image']