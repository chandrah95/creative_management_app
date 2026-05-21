// Field registry — to add a new field type:
//   1. Create MyField.js in this directory
//   2. Import and register it here
import InputField    from './InputField.js';
import TextareaField from './TextareaField.js';
import DateField     from './DateField.js';
import UrlField      from './UrlField.js';
import DropdownField from './DropdownField.js';
import NumberField   from './NumberField.js';
import CheckboxField from './CheckboxField.js';

const FIELDS = {
  input:    InputField,
  textarea: TextareaField,
  date:     DateField,
  url:      UrlField,
  dropdown: DropdownField,
  number:   NumberField,
  checkbox: CheckboxField
};

export function getField(type) {
  return FIELDS[type] || null;
}

export function renderField(fieldConfig, prefix = '') {
  const handler = getField(fieldConfig.type);
  if (!handler) {
    console.warn(`Unknown field type: "${fieldConfig.type}"`);
    return '';
  }
  return handler.render(fieldConfig, prefix);
}

export function validateField(fieldConfig, value) {
  const handler = getField(fieldConfig.type);
  return handler ? handler.validate(value, fieldConfig) : null;
}

export function getFieldValue(fieldConfig, prefix = '') {
  const handler = getField(fieldConfig.type);
  return handler ? handler.getValue(prefix + fieldConfig.name) : '';
}
