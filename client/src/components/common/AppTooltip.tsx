import * as Tooltip from '@radix-ui/react-tooltip';
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { APP_LAYER } from '../../constants/layers';

type TooltipSide = 'top' | 'right' | 'bottom' | 'left';
type TooltipAlign = 'start' | 'center' | 'end';

interface AppTooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: TooltipSide;
  align?: TooltipAlign;
  disabled?: boolean;
  delayDuration?: number;
}

export const AppTooltipProvider = ({ children }: { children: ReactNode }) => (
  <Tooltip.Provider delayDuration={400} skipDelayDuration={250}>
    {children}
  </Tooltip.Provider>
);

export const AppTooltip = ({
  content,
  children,
  side = 'top',
  align = 'center',
  disabled = false,
  delayDuration,
}: AppTooltipProps) => {
  if (disabled || !content || !isValidElement(children)) {
    return children;
  }

  const isDisabledButton =
    children.type === 'button' &&
    Boolean((children.props as { disabled?: boolean }).disabled);

  const trigger = isDisabledButton ? (
    <span className="inline-flex" tabIndex={0}>
      {children}
    </span>
  ) : (
    children
  );

  return (
    <Tooltip.Root delayDuration={delayDuration}>
      <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className="app-tooltip-content max-w-xs rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium leading-4 text-white shadow-lg"
          style={{ zIndex: APP_LAYER.tooltip }}
        >
          {content}
          <Tooltip.Arrow className="fill-slate-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};
