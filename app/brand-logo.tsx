import Image from "next/image";

export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      className={`official-brand-logo ${className}`.trim()}
      src="/brand/med-plus-250-wordmark-transparent.png"
      alt="med+250"
      width={440}
      height={280}
      priority
      unoptimized
    />
  );
}
