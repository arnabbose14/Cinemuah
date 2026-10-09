import React, { useState, useRef } from 'react';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholder?: React.ReactNode;
  style?: React.CSSProperties;
}

export function LazyImage({ src, alt, className, placeholder, style }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  if (!src || error) {
    return <>{placeholder}</> || null;
  }

  return (
    <>
      {!loaded && placeholder}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={className}
        style={{ ...style, display: loaded ? undefined : 'none' }}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        loading="lazy"
      />
    </>
  );
}
