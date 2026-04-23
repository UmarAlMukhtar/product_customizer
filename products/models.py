from django.db import models

# Create your models here.
class Product(models.Model):
    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return self.name
    
class ProductView(models.Model):
    ANGLE_CHOICES = [
        ('front', 'Front'),
        ('back', 'Back'),
        ('side', 'Side'),
    ]
    product = models.ForeignKey(Product, related_name='views', on_delete=models.CASCADE)
    angle = models.CharField(max_length=20, choices=ANGLE_CHOICES)
    color = models.CharField(max_length=30, default='#ffffff')
    base_image = models.ImageField(upload_to='product/')
    
    # Print area: where the design will be printed on the product
    print_area_x = models.IntegerField(default=0)
    print_area_y = models.IntegerField(default=0)
    print_area_width = models.IntegerField(default=100)
    print_area_height = models.IntegerField(default=100)
    
    def __str__(self):
        return f"{self.product.name} - {self.angle}"
    
class CustomizationRequest(models.Model):
    product_view = models.ForeignKey(ProductView, on_delete=models.CASCADE)
    user_design = models.ImageField(upload_to='designs/', null=True, blank=True)
    user_design_url = models.URLField(max_length=500, null=True, blank=True)
    result_image = models.ImageField(upload_to='results/', null=True, blank=True)
    result_image_url = models.URLField(max_length=500, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"Request #{self.id} for {self.product_view}"