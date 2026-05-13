interface ExpagLogoProps {
  collapsed?: boolean;
  className?: string;
}

export function ExpagLogo({ collapsed = false, className = "" }: ExpagLogoProps) {
  if (collapsed) {
    return (
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: '#0b1e4a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{
          color: '#ffffff', fontSize: '15px', fontWeight: 800,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          letterSpacing: '-0.5px', lineHeight: 1,
        }}>ex</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center ${className}`}>
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: '#0b1e4a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{
          color: '#ffffff', fontSize: '16px', fontWeight: 800,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          letterSpacing: '-0.5px', lineHeight: 1,
        }}>ex</span>
      </div>
      <span style={{
        color: '#e8edf5', fontSize: '18px', fontWeight: 600,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        letterSpacing: '-0.5px', lineHeight: 1, paddingLeft: '3px',
      }}>pag</span>
    </div>
  );
}
