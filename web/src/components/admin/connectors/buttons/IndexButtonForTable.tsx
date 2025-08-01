interface Props {
  onClick: () => void;
}

export const IndexButtonForTable = ({ onClick }: Props) => {
  return (
    <button
      className={
        "group relative " +
        "py-1 px-2 border border-transparent text-sm " +
        "font-medium rounded-md text-white bg-red-800 " +
        "hover:bg-red-900 focus:outline-none focus:ring-2 " +
        "focus:ring-offset-2 focus:ring-red-500 mx-auto"
      }
      onClick={onClick}
    >
      Index
    </button>
  );
};
