"use client";

import { useState, useEffect } from "react";
import ForceGraph from "@/app/Components/ForceGraph";
import { Tree } from "./generateTree";

export default function Home() {
  const [tree, setTree] = useState(new Tree());
  const [nodesAndLinks, setNodesAndLinks] = useState(tree.getNodesAndLinks());

  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(800);

  useEffect(() => {
    setWidth(window.innerWidth);
    setHeight(window.innerHeight);

    
    const handleResize = () => {
      setWidth(window.innerWidth);
      setHeight(window.innerHeight);
    };
    
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-between"> 
      <ForceGraph 
        // nodesData={[
        //   {id: '1', group: 1},
        //   {id: '2', group: 1},
        //   {id: '3', group: 2},
        //   {id: '4', group: 2},
        //   {id: '5', group: 3},
        // ]}
        // linksData={[
        //   {source: '1', target: '2'},
        //   {source: '1', target: '3'},
        //   {source: '2', target: '4'},
        //   {source: '3', target: '5'},
        // ]}
        nodesData={nodesAndLinks.nodes}
        linksData={nodesAndLinks.links}
        width={width}
        height={height}
      />
    </div>
  );
}
