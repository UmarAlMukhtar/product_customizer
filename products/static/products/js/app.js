// ===== DOM ELEMENTS =====
const uploadStep = document.getElementById("upload-step");
const catalogStep = document.getElementById("catalog-step");
const uploadForm = document.getElementById("upload-form");
const uploadZone = document.getElementById("upload-zone");
const designInput = document.getElementById("design-input");
const uploadBtn = document.getElementById("upload-btn");
const backBtn = document.getElementById("back-btn");
const addProductBtn = document.getElementById("add-product-btn");
const addProductModal = document.getElementById("add-product-modal");
const closeAddProductModalBtn = document.getElementById(
  "close-add-product-modal-btn",
);
const addProductCancelBtn = document.getElementById("add-product-cancel-btn");
const addProductForm = document.getElementById("add-product-form");
const addProductSelect = document.getElementById("add-product-select");
const addProductColorSelect = document.getElementById(
  "add-product-color-select",
);
const addProductAngleSelect = document.getElementById(
  "add-product-angle-select",
);
const addProductSubmitBtn = document.getElementById("add-product-submit-btn");
const addProductEmptyState = document.getElementById("add-product-empty-state");
const catalogGrid = document.getElementById("catalog-grid");
const selectAllCheckbox = document.getElementById("select-all-checkbox");
const downloadBatchBtn = document.getElementById("download-batch-btn");
const editModal = document.getElementById("edit-modal");
const closeModalBtn = document.getElementById("close-modal-btn");
const editForm = document.getElementById("edit-form");
const modalBaseImg = document.getElementById("modal-base-img");
const modalDesignOverlay = document.getElementById("modal-design-overlay");
const modalMoveX = document.getElementById("modal-move-x");
const modalMoveXValue = document.getElementById("modal-move-x-value");
const modalMoveY = document.getElementById("modal-move-y");
const modalMoveYValue = document.getElementById("modal-move-y-value");
const modalScale = document.getElementById("modal-scale");
const modalScaleValue = document.getElementById("modal-scale-value");
const modalRotation = document.getElementById("modal-rotation");
const modalRotationValue = document.getElementById("modal-rotation-value");
const modalResetBtn = document.getElementById("modal-reset-btn");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalSaveBtn = document.getElementById("modal-save-btn");
const productColorInputs = document.querySelectorAll(
  'input[name="product-color"]',
);
const modalProductColorInputs = document.querySelectorAll(
  'input[name="modal-product-color"]',
);

// ===== STATE =====
const state = {
  designFile: null,
  designUrl: "",
  productColor: "#ffffff",
  customizations: new Map(), // id -> {productView, request_id, result_url, transforms}
  selectedCustomizationIds: new Set(),
  currentEditingId: null,
  editingTransforms: { move_x: 0, move_y: 0, scale: 1, rotation_deg: 0 },
  editPreviewBaseUrl: "",
  editPreviewPrintArea: null,
  editPreviewBaseNaturalSize: null,
  currentEditingProductViewId: null,
  allProductViews: [],
};

async function init() {
  try {
    const response = await fetch("/api/product-views/");
    if (!response.ok) throw new Error("Failed to fetch product views");
    const data = await response.json();
    state.allProductViews = data.items;
    updateAddProductButtonState();
  } catch (error) {
    console.error("Could not initialize product views:", error);
    updateAddProductButtonState();
  }
}

function setUploadLoading(
  isLoading,
  labelText = "Select a design to generate",
) {
  uploadBtn.disabled = isLoading || !state.designFile;
  uploadBtn.classList.toggle("is-loading", isLoading);
  uploadBtn.textContent = isLoading ? "Generating..." : labelText;
}

// ===== STEP 1: UPLOAD FLOW =====

// FIX #1: Removed the redundant uploadZone click listener.
// The <label for="design-input"> already opens the file picker natively.
// Adding a manual designInput.click() causes a double-trigger that browsers
// interpret as an immediate cancel, making the picker appear to do nothing.

// FIX #2: Dragleave fires when the pointer moves into a child element (svg, h2, p),
// causing the drag-over highlight to flicker on/off. Using relatedTarget to check
// whether the new element is still inside the zone fixes this.
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", (e) => {
  // Only remove the class when the pointer actually leaves the zone entirely
  if (!uploadZone.contains(e.relatedTarget)) {
    uploadZone.classList.remove("drag-over");
  }
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(files[0]);
    designInput.files = dataTransfer.files;
    handleDesignSelected();
  }
});

designInput.addEventListener("change", handleDesignSelected);

productColorInputs.forEach((input) => {
  input.addEventListener("change", () => {
    state.productColor = input.value;
    if (state.designFile) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Generate Catalog";
    }
  });
});

function handleDesignSelected() {
  const file = designInput.files[0];
  if (file && file.type.startsWith("image/")) {
    state.designFile = file;
    state.designUrl = URL.createObjectURL(file);
    setUploadLoading(false, "Generate Catalog");
    updateAddProductButtonState();
  } else {
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Select a design to generate";
    updateAddProductButtonState();
  }
}

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.designFile) return;

  setUploadLoading(true);

  try {
    const formData = new FormData();
    formData.append("design", state.designFile);
    formData.append("color", state.productColor);
    formData.append("move_x", 0);
    formData.append("move_y", 0);
    formData.append("scale", 1);
    formData.append("rotation_deg", 0);

    const response = await fetch("/api/generate-catalog/", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("Generation failed");

    const data = await response.json();

    state.customizations.clear();
    data.results.forEach((result) => {
      if (result.success) {
        state.customizations.set(result.customization_request_id, {
          productView: {
            id: result.product_view_id,
            name: result.product_name,
            angle: result.angle,
            color: result.color,
            base_image_url: result.base_image_url,
          },
          printArea: result.print_area,
          request_id: result.customization_request_id,
          result_url: result.result_image_url,
          transforms: { move_x: 0, move_y: 0, scale: 1, rotation_deg: 0 },
        });
      }
    });

    uploadStep.classList.remove("step-active");
    catalogStep.classList.add("step-active");
    setUploadLoading(false, "Generate Catalog");
    renderCatalog();
  } catch (error) {
    console.error("Error:", error);
    // FIX #3: Re-enable the button on failure so the user can actually try again.
    // Previously the button stayed disabled forever after an error.
    setUploadLoading(false, "Try Again");
  }
});

// ===== STEP 2: CATALOG VIEW =====

function renderCatalog() {
  catalogGrid.innerHTML = "";
  state.selectedCustomizationIds.clear();
  selectAllCheckbox.checked = false;
  updateDownloadButton();

  state.customizations.forEach((customization, id) => {
    const card = createProductCard(id, customization);
    catalogGrid.appendChild(card);
  });

  updateAddProductButtonState();
}

function findProductViewById(id) {
  return state.allProductViews.find((view) => view.id === id) || null;
}

function getAvailableProductViews() {
  return state.allProductViews;
}

function getUniqueProducts() {
  const byProduct = new Map();
  state.allProductViews.forEach((view) => {
    if (!byProduct.has(view.product_id)) {
      byProduct.set(view.product_id, {
        product_id: view.product_id,
        product_name: view.product_name,
      });
    }
  });
  return Array.from(byProduct.values()).sort((a, b) =>
    a.product_name.localeCompare(b.product_name),
  );
}

function buildColorOptions(productId) {
  const colors = Array.from(
    new Set(
      state.allProductViews
        .filter((view) => view.product_id === productId)
        .map((view) => view.color),
    ),
  );

  addProductColorSelect.innerHTML = "";
  colors.forEach((color) => {
    const option = document.createElement("option");
    option.value = color;
    option.textContent = color === "#000000" ? "Black" : "White";
    addProductColorSelect.appendChild(option);
  });
}

function buildAngleOptions(productId, color) {
  const angleOrder = { front: 1, back: 2, side: 3 };
  const angles = Array.from(
    new Set(
      state.allProductViews
        .filter((view) => view.product_id === productId && view.color === color)
        .map((view) => view.angle),
    ),
  ).sort((a, b) => (angleOrder[a] || 99) - (angleOrder[b] || 99));

  addProductAngleSelect.innerHTML = "";
  angles.forEach((angle) => {
    const option = document.createElement("option");
    option.value = angle;
    option.textContent = angle.charAt(0).toUpperCase() + angle.slice(1);
    addProductAngleSelect.appendChild(option);
  });
}

function updateAddProductButtonState() {
  const canAdd =
    Boolean(state.designFile) && getAvailableProductViews().length > 0;
  addProductBtn.disabled = !canAdd;
}

function openAddProductModal() {
  const products = getUniqueProducts();
  addProductSelect.innerHTML = "";
  addProductColorSelect.innerHTML = "";
  addProductAngleSelect.innerHTML = "";

  if (products.length === 0) {
    addProductEmptyState.textContent = "No products are available to add.";
    addProductSubmitBtn.disabled = true;
    addProductColorSelect.disabled = true;
    addProductAngleSelect.disabled = true;
  } else {
    addProductEmptyState.textContent = "";
    addProductSubmitBtn.disabled = false;
    addProductColorSelect.disabled = false;
    addProductAngleSelect.disabled = false;
    products.forEach((product) => {
      const option = document.createElement("option");
      option.value = String(product.product_id);
      option.textContent = product.product_name;
      addProductSelect.appendChild(option);
    });
    const selectedProductId = Number.parseInt(addProductSelect.value, 10);
    buildColorOptions(selectedProductId);
    buildAngleOptions(selectedProductId, addProductColorSelect.value);
  }

  addProductModal.classList.add("active");
}

function closeAddProductModal() {
  addProductModal.classList.remove("active");
  addProductEmptyState.textContent = "";
  addProductSubmitBtn.disabled = false;
  addProductSubmitBtn.textContent = "Add Product";
}

addProductSelect.addEventListener("change", () => {
  const productId = Number.parseInt(addProductSelect.value, 10);
  if (!Number.isNaN(productId)) {
    buildColorOptions(productId);
    buildAngleOptions(productId, addProductColorSelect.value);
  }
});

addProductColorSelect.addEventListener("change", () => {
  const productId = Number.parseInt(addProductSelect.value, 10);
  if (!Number.isNaN(productId)) {
    buildAngleOptions(productId, addProductColorSelect.value);
  }
});

function createProductCard(id, customization) {
  const card = document.createElement("div");
  card.className = "product-card";
  card.dataset.id = id;

  const { productView, result_url } = customization;

  // FIX #4: Added a real id attribute to the checkbox so the <label for="checkbox-${id}">
  // actually points to something. Previously the for attribute referenced a non-existent id.
  card.innerHTML = `
    <div class="product-card-image">
      <img src="${result_url}" alt="${productView.name} - ${productView.angle}" loading="lazy" />
    </div>
    <div class="product-card-content">
      <h3 class="product-card-title">${productView.name}</h3>
      <p class="product-card-subtitle">${productView.angle.charAt(0).toUpperCase() + productView.angle.slice(1)}</p>
      <div class="product-card-checkbox">
        <input type="checkbox" id="checkbox-${id}" class="card-checkbox" data-id="${id}" />
        <label for="checkbox-${id}">Select</label>
      </div>
      <div class="product-card-actions">
        <button class="card-btn edit-btn" data-id="${id}">Edit</button>
        <button class="card-btn primary download-btn" data-id="${id}">Download</button>
      </div>
    </div>
  `;

  const checkbox = card.querySelector(".card-checkbox");
  checkbox.addEventListener("change", (e) => {
    if (e.target.checked) {
      state.selectedCustomizationIds.add(id);
    } else {
      state.selectedCustomizationIds.delete(id);
    }
    updateDownloadButton();
    updateSelectAllCheckbox();
  });

  card.querySelector(".edit-btn").addEventListener("click", () => {
    openEditModal(id, customization);
  });

  card.querySelector(".download-btn").addEventListener("click", () => {
    downloadSingle(id);
  });

  return card;
}

function updateSelectAllCheckbox() {
  const totalCards = state.customizations.size;
  const selectedCards = state.selectedCustomizationIds.size;
  selectAllCheckbox.checked = selectedCards === totalCards && totalCards > 0;
}

function updateDownloadButton() {
  downloadBatchBtn.disabled = state.selectedCustomizationIds.size === 0;
}

// FIX #5: "Select All" unchecking didn't clear selectedCustomizationIds.
// The .clear() only ran on the checked branch. Now both branches are handled correctly.
selectAllCheckbox.addEventListener("change", (e) => {
  if (e.target.checked) {
    state.customizations.forEach((_, id) => {
      state.selectedCustomizationIds.add(id);
      const checkbox = document.querySelector(`#checkbox-${id}`);
      if (checkbox) checkbox.checked = true;
    });
  } else {
    state.selectedCustomizationIds.clear();
    document.querySelectorAll(".card-checkbox").forEach((cb) => {
      cb.checked = false;
    });
  }
  updateDownloadButton();
});

downloadBatchBtn.addEventListener("click", async () => {
  const ids = Array.from(state.selectedCustomizationIds);
  if (ids.length === 0) return;

  downloadBatchBtn.disabled = true;

  try {
    const response = await fetch("/api/download-batch/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_ids: ids }),
    });

    if (!response.ok) throw new Error("Download failed");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customizations.zip";
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Batch download error:", error);
    alert("Download failed. Please try again.");
  } finally {
    downloadBatchBtn.disabled = false;
  }
});

async function downloadSingle(id) {
  try {
    const response = await fetch(`/api/download/${id}/`);
    if (!response.ok) throw new Error("Download failed");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const customization = state.customizations.get(id);
    const filename = `${customization.productView.name}_${customization.productView.angle}.png`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Download error:", error);
    alert("Download failed. Please try again.");
  }
}

// ===== EDIT MODAL =====

function openEditModal(id, customization) {
  state.currentEditingId = id;
  state.currentEditingProductViewId = customization.productView.id;
  state.editingTransforms = {
    move_x: customization.transforms.move_x ?? 0,
    move_y: customization.transforms.move_y ?? 0,
    scale: customization.transforms.scale,
    rotation_deg: customization.transforms.rotation_deg,
  };

  state.editPreviewBaseUrl = customization.productView.base_image_url;
  state.editPreviewPrintArea = customization.printArea || null;
  state.editPreviewBaseNaturalSize = null;
  modalBaseImg.src = state.editPreviewBaseUrl;
  modalDesignOverlay.src = state.designUrl;
  modalMoveX.value = state.editingTransforms.move_x;
  modalMoveXValue.textContent = `${state.editingTransforms.move_x}px`;
  modalMoveY.value = state.editingTransforms.move_y;
  modalMoveYValue.textContent = `${state.editingTransforms.move_y}px`;
  modalScale.value = Math.round(state.editingTransforms.scale * 100);
  modalScaleValue.textContent = `${modalScale.value}%`;
  modalRotation.value = state.editingTransforms.rotation_deg;
  modalRotationValue.textContent = `${state.editingTransforms.rotation_deg}°`;

  modalProductColorInputs.forEach((input) => {
    input.checked = input.value === customization.productView.color;
  });

  const syncPreviewImageSizes = () => {
    if (modalBaseImg.naturalWidth && modalBaseImg.naturalHeight) {
      state.editPreviewBaseNaturalSize = {
        width: modalBaseImg.naturalWidth,
        height: modalBaseImg.naturalHeight,
      };
    }
    updateEditPreview();
  };

  modalBaseImg.onload = syncPreviewImageSizes;
  modalDesignOverlay.onload = syncPreviewImageSizes;

  if (modalBaseImg.complete || modalDesignOverlay.complete) {
    syncPreviewImageSizes();
  }

  updateEditPreview();
  editModal.classList.add("active");
}

closeModalBtn.addEventListener("click", closeEditModal);
modalCancelBtn.addEventListener("click", closeEditModal);

function closeEditModal() {
  editModal.classList.remove("active");
  state.currentEditingId = null;
  state.currentEditingProductViewId = null;
}

function updateEditPreview() {
  if (!modalDesignOverlay) {
    return;
  }

  const printArea = state.editPreviewPrintArea;
  const baseSize = state.editPreviewBaseNaturalSize;

  if (
    !printArea ||
    !baseSize ||
    !modalBaseImg.complete ||
    !modalDesignOverlay.complete
  ) {
    return;
  }

  const designNaturalWidth = modalDesignOverlay.naturalWidth || 1;
  const designNaturalHeight = modalDesignOverlay.naturalHeight || 1;
  const fitRatio = Math.min(
    printArea.width / designNaturalWidth,
    printArea.height / designNaturalHeight,
  );
  const baseDesignWidth = designNaturalWidth * fitRatio;
  const baseDesignHeight = designNaturalHeight * fitRatio;
  const scale = state.editingTransforms.scale || 1;
  const rotation = state.editingTransforms.rotation_deg || 0;

  const baseRect = modalBaseImg.getBoundingClientRect();
  const stageRect = modalBaseImg.parentElement.getBoundingClientRect();
  const displayScale = baseRect.width / baseSize.width;

  const transformedWidth = baseDesignWidth * scale * displayScale;
  const transformedHeight = baseDesignHeight * scale * displayScale;

  const centerX =
    baseRect.left -
    stageRect.left +
    (printArea.x +
      printArea.width / 2 +
      (state.editingTransforms.move_x || 0)) *
      displayScale;
  const centerY =
    baseRect.top -
    stageRect.top +
    (printArea.y +
      printArea.height / 2 +
      (state.editingTransforms.move_y || 0)) *
      displayScale;

  modalDesignOverlay.style.width = `${transformedWidth}px`;
  modalDesignOverlay.style.height = `${transformedHeight}px`;
  modalDesignOverlay.style.left = `${centerX - transformedWidth / 2}px`;
  modalDesignOverlay.style.top = `${centerY - transformedHeight / 2}px`;
  modalDesignOverlay.style.transform = `rotate(${rotation}deg)`;
}

modalProductColorInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!state.currentEditingId) return;

    const customization = state.customizations.get(state.currentEditingId);
    const newColor = input.value;
    const currentProduct = state.allProductViews.find(
      (view) => view.id === customization.productView.id,
    );

    if (!currentProduct) return;

    const newProductView = state.allProductViews.find(
      (view) =>
        view.product_id === currentProduct.product_id &&
        view.angle === currentProduct.angle &&
        view.color === newColor,
    );

    if (newProductView) {
      const previousPrintArea = state.editPreviewPrintArea;
      const designNaturalWidth = modalDesignOverlay.naturalWidth || 0;
      const designNaturalHeight = modalDesignOverlay.naturalHeight || 0;

      // Keep perceived logo size stable across color variants by compensating
      // scale when print-area dimensions differ between views.
      if (
        previousPrintArea &&
        newProductView.print_area &&
        designNaturalWidth > 0 &&
        designNaturalHeight > 0
      ) {
        const oldFit = Math.min(
          previousPrintArea.width / designNaturalWidth,
          previousPrintArea.height / designNaturalHeight,
        );
        const newFit = Math.min(
          newProductView.print_area.width / designNaturalWidth,
          newProductView.print_area.height / designNaturalHeight,
        );

        if (oldFit > 0 && newFit > 0) {
          const compensatedScale =
            (state.editingTransforms.scale || 1) * (oldFit / newFit);
          state.editingTransforms.scale = Math.max(
            0.3,
            Math.min(compensatedScale, 2),
          );
          modalScale.value = Math.round(state.editingTransforms.scale * 100);
          modalScaleValue.textContent = `${modalScale.value}%`;
        }
      }

      state.currentEditingProductViewId = newProductView.id;
      state.editPreviewBaseUrl = newProductView.base_image_url;
      state.editPreviewPrintArea = newProductView.print_area;
      modalBaseImg.src = state.editPreviewBaseUrl;
      // The onload event will trigger updateEditPreview
    }
  });
});

modalMoveX.addEventListener("input", (e) => {
  state.editingTransforms.move_x = parseInt(e.target.value, 10);
  modalMoveXValue.textContent = `${state.editingTransforms.move_x}px`;
  updateEditPreview();
});

modalMoveY.addEventListener("input", (e) => {
  state.editingTransforms.move_y = parseInt(e.target.value, 10);
  modalMoveYValue.textContent = `${state.editingTransforms.move_y}px`;
  updateEditPreview();
});

modalScale.addEventListener("input", (e) => {
  state.editingTransforms.scale = e.target.value / 100;
  modalScaleValue.textContent = `${e.target.value}%`;
  updateEditPreview();
});

modalRotation.addEventListener("input", (e) => {
  state.editingTransforms.rotation_deg = parseInt(e.target.value);
  modalRotationValue.textContent = `${e.target.value}°`;
  updateEditPreview();
});

modalResetBtn.addEventListener("click", () => {
  state.editingTransforms.move_x = 0;
  state.editingTransforms.move_y = 0;
  state.editingTransforms.scale = 1;
  state.editingTransforms.rotation_deg = 0;
  modalMoveX.value = 0;
  modalMoveY.value = 0;
  modalMoveXValue.textContent = "0px";
  modalMoveYValue.textContent = "0px";
  modalScale.value = 100;
  modalScaleValue.textContent = "100%";
  modalRotation.value = 0;
  modalRotationValue.textContent = "0°";
  updateEditPreview();
});

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.currentEditingId) return;

  const id = state.currentEditingId;
  modalSaveBtn.disabled = true;
  modalSaveBtn.textContent = "Saving...";

  try {
    const formData = new FormData();
    formData.append("scale", state.editingTransforms.scale);
    formData.append("rotation_deg", state.editingTransforms.rotation_deg);
    formData.append("move_x", state.editingTransforms.move_x);
    formData.append("move_y", state.editingTransforms.move_y);
    const selectedColor = document.querySelector(
      'input[name="modal-product-color"]:checked',
    ).value;
    formData.append("color", selectedColor);
    if (state.currentEditingProductViewId) {
      formData.append("product_view_id", state.currentEditingProductViewId);
    }

    const response = await fetch(`/api/edit/${id}/`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("Edit failed");

    const data = await response.json();

    const customization = state.customizations.get(id);
    customization.result_url = data.result_image_url;
    customization.transforms = {
      move_x: state.editingTransforms.move_x,
      move_y: state.editingTransforms.move_y,
      scale: state.editingTransforms.scale,
      rotation_deg: state.editingTransforms.rotation_deg,
    };
    // Update product view info from server response
    customization.productView.id = data.product_view.id;
    if (data.product_view.product_id) {
      customization.productView.product_id = data.product_view.product_id;
    }
    if (data.product_view.product_name) {
      customization.productView.name = data.product_view.product_name;
    }
    if (data.product_view.angle) {
      customization.productView.angle = data.product_view.angle;
    }
    customization.productView.color = data.product_view.color;
    customization.productView.base_image_url = data.product_view.base_image_url;
    customization.printArea = data.product_view.print_area;

    const card = document.querySelector(`.product-card[data-id="${id}"]`);
    if (card) {
      const img = card.querySelector("img");
      img.src = data.result_image_url;
    }

    closeEditModal();
  } catch (error) {
    console.error("Edit error:", error);
    alert("Edit failed. Please try again.");
  } finally {
    modalSaveBtn.disabled = false;
    modalSaveBtn.textContent = "Save Changes";
  }
});

addProductBtn.addEventListener("click", () => {
  openAddProductModal();
});

closeAddProductModalBtn.addEventListener("click", closeAddProductModal);
addProductCancelBtn.addEventListener("click", closeAddProductModal);

addProductModal.addEventListener("click", (e) => {
  if (e.target === addProductModal) {
    closeAddProductModal();
  }
});

addProductForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const selectedProductId = Number.parseInt(addProductSelect.value, 10);
  const selectedColor = addProductColorSelect.value;
  const selectedAngle = addProductAngleSelect.value;
  const selectedView = state.allProductViews.find(
    (view) =>
      view.product_id === selectedProductId &&
      view.color === selectedColor &&
      view.angle === selectedAngle,
  );

  if (!selectedView) {
    addProductEmptyState.textContent = "Please select a valid product view.";
    return;
  }

  addProductSubmitBtn.disabled = true;
  addProductSubmitBtn.textContent = "Adding...";

  try {
    const formData = new FormData();
    formData.append("product_view_id", selectedView.id);
    formData.append("design", state.designFile);
    formData.append("move_x", 0);
    formData.append("move_y", 0);
    formData.append("scale", 1);
    formData.append("rotation_deg", 0);

    const response = await fetch("/api/customize/", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("Could not add product");

    const data = await response.json();
    const requestId = data.request_id;

    state.customizations.set(requestId, {
      productView: {
        id: selectedView.id,
        product_id: selectedView.product_id,
        name: selectedView.product_name,
        angle: selectedView.angle,
        color: selectedView.color,
        base_image_url: selectedView.base_image_url,
      },
      printArea: selectedView.print_area,
      request_id: requestId,
      result_url: data.result_image_url,
      transforms: { move_x: 0, move_y: 0, scale: 1, rotation_deg: 0 },
    });

    renderCatalog();
    closeAddProductModal();
  } catch (error) {
    console.error("Add product error:", error);
    addProductEmptyState.textContent =
      "Failed to add product right now. Please try again.";
  } finally {
    addProductSubmitBtn.disabled = false;
    addProductSubmitBtn.textContent = "Add Product";
  }
});

editModal.addEventListener("click", (e) => {
  if (e.target === editModal) {
    closeEditModal();
  }
});

// ===== BACK BUTTON =====

backBtn.addEventListener("click", () => {
  catalogStep.classList.remove("step-active");
  uploadStep.classList.add("step-active");
  designInput.value = "";
  state.designFile = null;
  state.productColor = "#ffffff";
  productColorInputs.forEach((input) => {
    input.checked = input.value === "#ffffff";
  });
  setUploadLoading(false);
  updateAddProductButtonState();
});

init();
