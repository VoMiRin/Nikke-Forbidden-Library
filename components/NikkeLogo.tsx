import React from 'react';

interface SVGProps extends React.SVGProps<SVGSVGElement> {}

/** 금서고 타로 카드 마크: 이중 사각 테두리 안의 네 갈래 별 */
export const NikkeLogo: React.FC<SVGProps> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 22 32"
    fill="none"
    {...props}
  >
    <rect x="0.75" y="0.75" width="20.5" height="30.5" rx="2" className="stroke-nikke-accent" strokeWidth="1.5" />
    <rect x="3.5" y="3.5" width="15" height="25" rx="1" className="stroke-nikke-accent" strokeOpacity="0.45" />
    <path d="M11 9.5l1.6 4.9 4.9 1.6-4.9 1.6L11 22.5l-1.6-4.9L4.5 16l4.9-1.6Z" className="fill-nikke-text-primary" />
  </svg>
);
