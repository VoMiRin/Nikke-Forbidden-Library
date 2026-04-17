import React from 'react';

interface NextSubChapterButtonProps {
  buttonText: string;
  onNavigate: () => void;
}

export const NextSubChapterButton: React.FC<NextSubChapterButtonProps> = ({ buttonText, onNavigate }) => {
  return (
    <div className="my-8 flex justify-center md:my-12">
      <button
        onClick={onNavigate}
        className="rounded-full bg-nikke-gradient px-6 py-3 text-sm font-semibold text-slate-950 shadow-glass transition-all duration-300 ease-editorial hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-nikke-accent md:px-8 md:py-4 md:text-base"
        aria-label={`Navigate to next: ${buttonText}`}
      >
        {buttonText}
      </button>
    </div>
  );
};
