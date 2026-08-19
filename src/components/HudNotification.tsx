interface HudNotificationProps {
  message: string | null;
}

export function HudNotification({ message }: HudNotificationProps) {
  if (!message) return null;

  return (
    <div className="hud-toast" role="status" aria-live="polite">
      <div className="hud-toast-content">
        <span>{message}</span>
      </div>
    </div>
  );
}
