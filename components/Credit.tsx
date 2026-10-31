/** Creator credit, shown across the app. */
export const CREATOR = {
  name: "Harsh Prajapati",
  url: "https://www.instagram.com/harshprajapatiofficial/",
};

export function Credit({ className = "" }: { className?: string }) {
  return (
    <p className={`credit ${className}`}>
      Made with <span className="credit-heart" aria-label="love" role="img">❤️</span> by{" "}
      <a href={CREATOR.url} target="_blank" rel="noopener noreferrer">
        {CREATOR.name}
      </a>
    </p>
  );
}
