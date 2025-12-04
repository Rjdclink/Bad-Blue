/**
 * LawBookCheckbox - Custom checkbox component that displays a law book image
 * Shows a green law book spine image when unchecked or checked
 */

import { Checkbox } from "@/components/ui/checkbox";

interface LawBookCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  console.error('Law book image failed to load:', e.currentTarget.src);
  e.currentTarget.style.display = 'none';
};

export function LawBookCheckbox({ checked, onCheckedChange, className }: LawBookCheckboxProps) {
  return (
    <div className="flex items-center gap-3">
      <img 
        src="/images/Law-book.webp" 
        alt="" 
        className={`w-5 h-5 object-contain ${checked ? 'opacity-100' : 'opacity-70'} transition-opacity`}
        role="presentation"
        onError={handleImageError}
      />
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={className}
      />
    </div>
  );
}
