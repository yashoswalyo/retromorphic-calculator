// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
    is_rad: bool,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str, is_rad: bool) -> Self {
        Self {
            chars: input.chars().peekable(),
            is_rad,
        }
    }

    fn consume_whitespace(&mut self) {
        while let Some(&c) = self.chars.peek() {
            if c.is_whitespace() {
                self.chars.next();
            } else {
                break;
            }
        }
    }

    fn parse(&mut self) -> Result<f64, String> {
        let val = self.parse_expr()?;
        self.consume_whitespace();
        if let Some(&c) = self.chars.peek() {
            return Err(format!("Unexpected character: '{}'", c));
        }
        Ok(val)
    }

    fn parse_expr(&mut self) -> Result<f64, String> {
        let mut val = self.parse_term()?;
        loop {
            self.consume_whitespace();
            match self.chars.peek() {
                Some('+') => {
                    self.chars.next();
                    let right = self.parse_term()?;
                    val += right;
                }
                Some('-') => {
                    self.chars.next();
                    let right = self.parse_term()?;
                    val -= right;
                }
                _ => break,
            }
        }
        Ok(val)
    }

    fn parse_term(&mut self) -> Result<f64, String> {
        let mut val = self.parse_factor()?;
        loop {
            self.consume_whitespace();
            match self.chars.peek() {
                Some('*') => {
                    self.chars.next();
                    let right = self.parse_factor()?;
                    val *= right;
                }
                Some('/') => {
                    self.chars.next();
                    let right = self.parse_factor()?;
                    if right == 0.0 {
                        return Err("Division by zero".to_string());
                    }
                    val /= right;
                }
                Some('%') => {
                    self.chars.next();
                    let right = self.parse_factor()?;
                    if right == 0.0 {
                        return Err("Modulo by zero".to_string());
                    }
                    val %= right;
                }
                _ => break,
            }
        }
        Ok(val)
    }

    fn parse_factor(&mut self) -> Result<f64, String> {
        let mut val = self.parse_primary()?;
        self.consume_whitespace();
        if let Some('^') = self.chars.peek() {
            self.chars.next();
            let exponent = self.parse_factor()?;
            val = val.powf(exponent);
        }
        Ok(val)
    }

    fn parse_primary(&mut self) -> Result<f64, String> {
        self.consume_whitespace();
        match self.chars.peek() {
            Some('(') => {
                self.chars.next();
                let val = self.parse_expr()?;
                self.consume_whitespace();
                if self.chars.next() != Some(')') {
                    return Err("Expected matching ')'".to_string());
                }
                Ok(val)
            }
            Some('-') => {
                self.chars.next();
                let val = self.parse_primary()?;
                Ok(-val)
            }
            Some('+') => {
                self.chars.next();
                let val = self.parse_primary()?;
                Ok(val)
            }
            Some(c) if c.is_digit(10) || *c == '.' => {
                let mut num_str = String::new();
                let mut has_dot = false;
                while let Some(&ch) = self.chars.peek() {
                    if ch.is_digit(10) {
                        num_str.push(self.chars.next().unwrap());
                    } else if ch == '.' && !has_dot {
                        has_dot = true;
                        num_str.push(self.chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                num_str.parse::<f64>().map_err(|_| "Invalid number format".to_string())
            }
            Some(c) if c.is_ascii_alphabetic() => {
                let mut ident = String::new();
                while let Some(&ch) = self.chars.peek() {
                    if ch.is_ascii_alphabetic() {
                        ident.push(self.chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                
                match ident.as_str() {
                    "pi" => Ok(std::f64::consts::PI),
                    "e" => Ok(std::f64::consts::E),
                    "sqrt" | "sin" | "cos" | "tan" | "ln" | "log" => {
                        self.consume_whitespace();
                        if self.chars.next() != Some('(') {
                            return Err(format!("Expected '(' after function '{}'", ident));
                        }
                        let val = self.parse_expr()?;
                        self.consume_whitespace();
                        if self.chars.next() != Some(')') {
                            return Err(format!("Expected matching ')' for function '{}'", ident));
                        }
                        
                        match ident.as_str() {
                            "sqrt" => {
                                if val < 0.0 {
                                    Err("Square root of a negative number".to_string())
                                } else {
                                    Ok(val.sqrt())
                                }
                            }
                            "sin" => {
                                if self.is_rad {
                                    Ok(val.sin())
                                } else {
                                    Ok(val.to_radians().sin())
                                }
                            }
                            "cos" => {
                                if self.is_rad {
                                    Ok(val.cos())
                                } else {
                                    Ok(val.to_radians().cos())
                                }
                            }
                            "tan" => {
                                if self.is_rad {
                                    Ok(val.tan())
                                } else {
                                    Ok(val.to_radians().tan())
                                }
                            }
                            "ln" => {
                                if val <= 0.0 {
                                    Err("Natural log of a non-positive number".to_string())
                                } else {
                                    Ok(val.ln())
                                }
                            }
                            "log" => {
                                if val <= 0.0 {
                                    Err("Logbase 10 of a non-positive number".to_string())
                                } else {
                                    Ok(val.log10())
                                }
                            }
                            _ => unreachable!(),
                        }
                    }
                    _ => Err(format!("Unknown identifier: '{}'", ident)),
                }
            }
            Some(c) => Err(format!("Unexpected token: '{}'", c)),
            None => Err("Unexpected end of expression".to_string()),
        }
    }
}

#[tauri::command]
fn calculate(op: &str, a: f64, b: f64) -> Result<f64, String> {
    match op {
        "add" | "+" => Ok(a + b),
        "subtract" | "-" => Ok(a - b),
        "multiply" | "*" => Ok(a * b),
        "divide" | "/" => {
            if b == 0.0 {
                Err("Division by zero".to_string())
            } else {
                Ok(a / b)
            }
        }
        "modulo" | "%" => {
            if b == 0.0 {
                Err("Modulo by zero".to_string())
            } else {
                Ok(a % b)
            }
        }
        "power" | "^" => Ok(a.powf(b)),
        _ => Err(format!("Unknown operation: {}", op)),
    }
}

#[tauri::command]
fn evaluate_expression(expression: &str, is_rad: bool) -> Result<f64, String> {
    // Standardize representation: replace standard division and multiplication signs if sent from UI
    let sanitized = expression
        .replace('×', "*")
        .replace('÷', "/")
        .replace('−', "-");
    let mut parser = Parser::new(&sanitized, is_rad);
    parser.parse()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![calculate, evaluate_expression])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
