'use client';
import React, { useEffect } from 'react';

const LegacySearch = () => {
    useEffect(() => {
        document.title = 'Legacy Search';
    }, []);

    return (
        <div style={{ width: '100%', height: '100vh' }}>
            <iframe
                src="http://13.202.103.72:8501/"
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Legacy Search"
            />
        </div>
    );
};

export default LegacySearch;