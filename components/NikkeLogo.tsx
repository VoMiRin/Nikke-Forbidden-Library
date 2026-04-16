
import React from 'react';

interface SVGProps extends React.SVGProps<SVGSVGElement> {}

export const NikkeLogo: React.FC<SVGProps> = (props) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 100 100" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="5"
    {...props}
  >
    {/* Outer Hexagon (Symbolizing Ark or Technology) */}
    <path d="M50 5 L93.3 27.5 L93.3 72.5 L50 95 L6.7 72.5 L6.7 27.5 Z" strokeWidth="4" />
    
    {/* Inner "N" like shape (Stylized Nikke Initial) */}
    <path d="M30 70 L30 30 L50 50 L70 30 L70 70" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />

    {/* Optional: Small circle (Core/Energy) */}
    <circle cx="50" cy="50" r="5" fill="currentColor" stroke="none"/>
  </svg>
);
