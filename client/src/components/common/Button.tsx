export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'violet'
  | 'cyan'
  | 'ghost'
  | 'text'
  | 'textError'
  | 'icon';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}

const baseButtonClassName =
  'inline-flex items-center justify-center align-middle select-none whitespace-nowrap font-sans font-medium text-center antialiased ' +
  'transition duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'transition duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 cursor-pointer ' +
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';

// A 1px bevel instead of 2px, and a softer one: at this button height a heavy
// inner shadow reads as a chunky toy control rather than a dense ERP one.
const raisedButtonClassName =
  'relative border shadow-sm hover:shadow ' +
  'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] ' +
  'after:shadow-[inset_0_1px_0px_rgba(255,255,255,0.22),inset_0_-1px_0px_rgba(0,0,0,0.12)]';

const variantClassNames: Record<ButtonVariant, string> = {
  primary:
    `${raisedButtonClassName} rounded-lg border-stone-900 bg-gradient-to-b from-stone-700 to-stone-800 text-stone-50 ` +
    'hover:from-stone-800 hover:to-stone-900 focus-visible:ring-stone-500',
  secondary:
    `${raisedButtonClassName} rounded-lg border-slate-200 bg-gradient-to-b from-white to-slate-50 text-slate-700 ` +
    'hover:from-slate-50 hover:to-slate-100 focus-visible:ring-slate-400',
  info:
    `${raisedButtonClassName} rounded-lg border-blue-600 bg-gradient-to-b from-blue-500 to-blue-600 text-white ` +
    'hover:from-blue-600 hover:to-blue-700 focus-visible:ring-blue-500',
  success:
    `${raisedButtonClassName} rounded-lg border-emerald-600 bg-gradient-to-b from-emerald-500 to-emerald-600 text-white ` +
    'hover:from-emerald-600 hover:to-emerald-700 focus-visible:ring-emerald-500',
  warning:
    `${raisedButtonClassName} rounded-lg border-amber-600 bg-gradient-to-b from-amber-500 to-amber-600 text-white ` +
    'hover:from-amber-600 hover:to-amber-700 focus-visible:ring-amber-500',
  error:
    `${raisedButtonClassName} rounded-lg border-rose-600 bg-gradient-to-b from-rose-500 to-rose-600 text-white ` +
    'hover:from-rose-600 hover:to-rose-700 focus-visible:ring-rose-500',
  violet:
    `${raisedButtonClassName} rounded-lg border-violet-600 bg-gradient-to-b from-violet-500 to-violet-600 text-white ` +
    'hover:from-violet-600 hover:to-violet-700 focus-visible:ring-violet-500',
  cyan:
    `${raisedButtonClassName} rounded-lg border-cyan-600 bg-gradient-to-b from-cyan-500 to-cyan-600 text-white ` +
    'hover:from-cyan-600 hover:to-cyan-700 focus-visible:ring-cyan-500',
  ghost:
    'rounded-lg border border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400',
  text:
    'rounded-md text-blue-600 hover:bg-blue-50 hover:text-blue-800 focus-visible:ring-blue-500',
  textError:
    'rounded-md text-rose-600 hover:bg-rose-50 hover:text-rose-800 focus-visible:ring-rose-500',
  icon:
    'rounded-lg border border-transparent bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-slate-400',
};

// Tuned for a 1366x768 operator screen: at the old scale a row of four status
// actions wrapped onto a second line, which pushed the data below the fold.
const sizeClassNames: Record<ButtonSize, string> = {
  xs: 'gap-1 px-2 py-1 text-xs',
  sm: 'gap-1.5 px-2.5 py-1.5 text-xs sm:text-sm',
  md: 'gap-1.5 px-3 py-1.5 text-xs sm:px-3.5 sm:py-2 sm:text-sm',
  lg: 'gap-2 px-4 py-2.5 text-sm font-semibold',
  icon: 'h-9 w-9 p-0',
};

export const getButtonClassName = ({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
}: ButtonClassNameOptions = {}): string =>
  [
    baseButtonClassName,
    variantClassNames[variant],
    sizeClassNames[size],
    block ? 'w-full' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

export const PrimaryButton = getButtonClassName({ variant: 'primary' });
export const SecondaryButton = getButtonClassName({ variant: 'secondary' });
export const InfoButton = getButtonClassName({ variant: 'info' });
export const SuccessButton = getButtonClassName({ variant: 'success' });
export const WarningButton = getButtonClassName({ variant: 'warning' });
export const ErrorButton = getButtonClassName({ variant: 'error' });
export const VioletButton = getButtonClassName({ variant: 'violet' });
export const CyanButton = getButtonClassName({ variant: 'cyan' });
export const GhostButton = getButtonClassName({ variant: 'ghost' });
export const TextButton = getButtonClassName({ variant: 'text', size: 'xs' });
export const TextErrorButton = getButtonClassName({
  variant: 'textError',
  size: 'xs',
});
export const IconButton = getButtonClassName({
  variant: 'icon',
  size: 'icon',
});
