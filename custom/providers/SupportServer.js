
// Function to create a support request
export const createSupportRequest = async (url, tx, address, reward) => {
    console.log("url::::::", `${url}/support/request`);
    console.log("address:", address);
    console.log("reward:", reward);
    console.log("reward:", tx);
    try {
        const response = await fetch(`http://${url}/support/request`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({tx, address, reward}),
        });

        const data = await response.json(); // Parse the JSON response
        return data;
    } catch (error) {
        console.error('Error creating support request:', error);
        return { status: false };
    }
};

// Function to get the support request by hash
export const getSupportRequestStatus = async (url, hash) => {
    try {
        const response = await fetch(`http://${url}/support/request/${hash}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json(); // Parse the JSON response
        return data;
    } catch (error) {
        console.error('Error fetching support request:', error);
        return { status: false, tickets: [] };
    }
};

// Function to get the support available difficulties by hash
export const getAvailableDifficulaties = async (url) => {
    try {
        const response = await fetch(`http://${url}/support/difficulties`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json(); // Parse the JSON response
        return data;
    } catch (error) {
        console.error('Error fetching support request:', error);
        return { status: false, tickets: [] };
    }
};