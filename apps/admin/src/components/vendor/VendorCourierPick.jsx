import Input from '../ui/Input';
import Select from '../ui/Select';

/** Names a vendor may type. These are the vendor’s own booking, not an OMSKing courier. */
export const VENDOR_COURIER_CHOICES = [
  'Delhivery',
  'Bluedart',
  'Ecom Express',
  'Xpressbees',
  'DTDC',
  'India Post',
  'Other',
];

export function isOtherCourier(value) {
  if (!value) return false;
  return !VENDOR_COURIER_CHOICES.filter((name) => name !== 'Other').includes(value);
}

export function courierSelectValue(value) {
  if (!value) return '';
  return isOtherCourier(value) ? 'Other' : value;
}

export function resolveVendorCourier(selectValue, otherName) {
  if (selectValue === 'Other') return String(otherName || '').trim();
  return String(selectValue || '').trim();
}

export default function VendorCourierPick({
  value,
  onChange,
  otherName,
  onOtherName,
  className = 'w-44',
  selectClassName = 'h-9',
  label = 'Your courier',
  hint,
  showHint = true,
}) {
  const selected = courierSelectValue(value);
  const other = selected === 'Other';
  const typed = otherName != null ? otherName : (other ? value : '');

  return (
    <div className={className}>
      {label ? <label className="mb-1 block text-xs text-muted-foreground">{label}</label> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className={other ? `${selectClassName} w-36` : selectClassName}
          value={selected}
          onChange={(e) => {
            const next = e.target.value;
            if (next === 'Other') onChange('Other');
            else onChange(next);
          }}
        >
          <option value="">Select courier</option>
          {VENDOR_COURIER_CHOICES.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </Select>
        {other && (
          <Input
            className="h-9 w-44"
            value={typed === 'Other' ? '' : typed}
            onChange={(e) => (onOtherName ? onOtherName(e.target.value) : onChange(e.target.value))}
            placeholder="Courier name"
            aria-label="Courier name"
          />
        )}
      </div>
      {showHint && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {hint || 'Your courier. Vendor parcels are not booked on OMSKing accounts.'}
        </p>
      )}
    </div>
  );
}
