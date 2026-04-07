use alloy::sol_types::{sol, SolType};

sol! {
    struct MyStruct {
        uint256 value;
    }
}

fn main() {
    let my_struct = MyStruct { value: alloy::primitives::U256::from(123) };
    let encoded = my_struct.abi_encode();
    println!("Encoded: {:?}", encoded);
}
