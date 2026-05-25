export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    return `
      <div class="field-group ${field.width || 'full'}" data-field="${id}">
        <label class="field-label">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <div class="multitext-wrap">
          <div class="multitext-input-row">
            <input type="text" id="${id}-input" class="field-input multitext-input"
              placeholder="${field.placeholder || 'e.g. 100x200x50mm'}"
              onkeydown="if(event.key==='Enter'){event.preventDefault();window.multitextAdd('${id}')}">
            <button type="button" class="multitext-add-btn" onclick="window.multitextAdd('${id}')">+ Add</button>
          </div>
          <div class="multitext-tags" id="${id}-tags"></div>
          <input type="hidden" id="${id}" name="${id}" value="[]">
        </div>
        <span class="field-error" id="${id}-error"></span>
      </div>`;
  },

  validate(value, field) {
    if (field.required) {
      try {
        const arr = JSON.parse(value || '[]');
        if (!arr.length) return `${field.label} requires at least one entry`;
      } catch { return `${field.label} requires at least one entry`; }
    }
    return null;
  },

  getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '[]';
  }
};
