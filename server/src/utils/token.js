import jwt from 'jsonwebtoken';
export const tokenFor=user=>jwt.sign({id:user._id,email:user.email},process.env.JWT_SECRET,{expiresIn:'7d'});
