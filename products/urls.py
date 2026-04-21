from django.urls import path
from . import views

urlpatterns = [
    path('', views.frontend, name='frontend'),
    path('product-views/', views.product_views, name='product_views'),
    path('customize/', views.customize, name='customize'),
    path('generate-catalog/', views.generate_catalog, name='generate_catalog'),
    path('download/<int:request_id>/', views.download_customization, name='download_customization'),
    path('download-batch/', views.download_batch, name='download_batch'),
    path('edit/<int:request_id>/', views.edit_customization, name='edit_customization'),
]