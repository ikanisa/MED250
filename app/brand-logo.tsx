import Image from "next/image";

export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      className={`official-brand-logo ${className}`.trim()}
      src="/brand/med-plus-250-wordmark.png"
      alt="med+250"
      width={1100}
      height={700}
      priority
      unoptimized
    />
  );
}
