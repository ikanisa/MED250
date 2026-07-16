import Image from "next/image";

export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      className={`official-brand-logo ${className}`.trim()}
      src="/brand/med-plus-250-wordmark-220.png"
      alt="med+250"
      width={220}
      height={140}
      priority
      unoptimized
    />
  );
}
