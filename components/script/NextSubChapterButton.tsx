import React from 'react';

interface NextSubChapterButtonProps {
  buttonText: string;
  onNavigate: () => void;
}

export const NextSubChapterButton: React.FC<NextSubChapterButtonProps> = ({ buttonText, onNavigate }) => {
  return (
    <div className="my-12 flex justify-center">
      <button
        onClick={onNavigate}
        className="rounded-full bg-nikke-gradient px-8 py-4 text-base font-semibold text-slate-950 shadow-glass transition-all duration-300 ease-editorial hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-nikke-accent"
        aria-label={`Navigate to next: ${buttonText}`}
      >
        {buttonText}
      </button>
    </div>
  );
};
